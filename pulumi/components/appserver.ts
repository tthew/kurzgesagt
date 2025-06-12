import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface AppServerArgs {
    projectName: string;
    environment: string;
    vpcId: pulumi.Input<string>;
    subnetIds: pulumi.Input<string>[];
    securityGroupId: pulumi.Input<string>;
    instanceType: string;
    desiredCapacity: number;
    minSize: number;
    maxSize: number;
    postgresEndpoint: pulumi.Input<string>;
    postgresUsername: string;
    postgresPassword: pulumi.Input<string>;
    postgresDbName: string;
    redisEndpoint: pulumi.Input<string>;
    couchdbEndpoint: pulumi.Input<string>;
}

export class AppServer extends pulumi.ComponentResource {
    public readonly asgName: pulumi.Output<string>;
    public readonly asgId: pulumi.Output<string>;
    public readonly targetGroupArn: pulumi.Output<string>;
    public readonly launchTemplateId: pulumi.Output<string>;

    constructor(name: string, args: AppServerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("tinyurl:components:AppServer", name, {}, opts);

        // Get latest Amazon Linux 2 AMI
        const ami = aws.ec2.getAmi({
            mostRecent: true,
            owners: ["amazon"],
            filters: [
                {
                    name: "name",
                    values: ["amzn2-ami-hvm-*-x86_64-gp2"],
                },
                {
                    name: "virtualization-type",
                    values: ["hvm"],
                },
            ],
        });

        // User data script
        const userData = pulumi.all([
            args.postgresEndpoint,
            args.redisEndpoint,
            args.couchdbEndpoint,
            args.postgresPassword
        ]).apply(([pgEndpoint, redisEndpoint, couchdbEndpoint, pgPassword]) => {
            // Parse PostgreSQL endpoint to extract host and port
            const pgParts = pgEndpoint.split(':');
            const pgHost = pgParts[0];
            const pgPort = pgParts[1] || '5432';
            
            // Parse Redis endpoint to extract host
            const redisHost = redisEndpoint.split(':')[0];
            
            // Parse CouchDB endpoint to extract host
            const couchdbHost = couchdbEndpoint.replace('http://', '').split(':')[0];
            
            return `#!/bin/bash -x
exec > >(tee /var/log/user-data.log)
exec 2>&1

# Log start
echo "Starting user data script at $(date)"

# Update system
echo "Updating system packages..."
yum update -y

# Install Node.js 16 using direct binary download
echo "Installing Node.js..."
NODE_VERSION="v16.20.2"
NODE_DISTRO="linux-x64"
NODE_URL="https://nodejs.org/dist/\${NODE_VERSION}/node-\${NODE_VERSION}-\${NODE_DISTRO}.tar.xz"

# Download and extract Node.js
cd /tmp
curl -fsSL \${NODE_URL} -o node.tar.xz
tar -xJf node.tar.xz
rm node.tar.xz

# Move to /usr/local
mv node-\${NODE_VERSION}-\${NODE_DISTRO} /usr/local/node

# Create symlinks
ln -sf /usr/local/node/bin/node /usr/bin/node
ln -sf /usr/local/node/bin/npm /usr/bin/npm
ln -sf /usr/local/node/bin/npx /usr/bin/npx

# Verify Node.js installation
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js installation failed!"
    exit 1
fi
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# Return to home directory
cd /

# Get region
REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
echo "Region: \$REGION"

# Get CouchDB admin password from SSM
echo "Getting CouchDB password from SSM..."
COUCHDB_PASSWORD=$(aws ssm get-parameter --name "/${args.projectName}/${args.environment}/couchdb/admin_password" --with-decryption --query 'Parameter.Value' --output text --region \$REGION 2>&1)
if [ \$? -ne 0 ]; then
    echo "ERROR: Failed to retrieve CouchDB password from SSM: \$COUCHDB_PASSWORD"
    COUCHDB_PASSWORD="admin"  # Fallback for testing
else
    echo "Successfully retrieved CouchDB password from SSM"
fi

# Create app directory
echo "Creating application directory..."
mkdir -p /opt/app
cd /opt/app

# Create package.json with all dependencies
echo "Creating package.json..."
cat > package.json <<'PACKAGEJSON'
{
  "name": "tinyurl-api",
  "version": "1.0.0",
  "description": "TinyURL API Server",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.3",
    "redis": "^4.6.7",
    "nano": "^10.1.2",
    "nanoid": "^3.3.6",
    "helmet": "^7.0.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1"
  }
}
PACKAGEJSON

# Create the actual application code
cat > server.js <<'SERVEREOF'
const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const nano = require('nano');
const { nanoid } = require('nanoid');
const helmet = require('helmet');
const cors = require('cors');

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// PostgreSQL connection pool
const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'tinyurl',
  user: process.env.POSTGRES_USER || 'dbadmin',
  password: process.env.POSTGRES_PASSWORD || 'postgres123',
  ssl: {
    rejectUnauthorized: false
  }
});

// Redis client
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  }
});

// CouchDB connection
const couchdbUrl = \`http://\${process.env.COUCHDB_USER}:\${process.env.COUCHDB_PASSWORD}@\${process.env.COUCHDB_HOST}:\${process.env.COUCHDB_PORT}\`;
const couchdb = nano(couchdbUrl);

// Initialize connections
async function initializeConnections() {
  try {
    // Connect to Redis
    await redisClient.connect();
    console.log('Connected to Redis');

    // Test PostgreSQL connection
    await pgPool.query('SELECT NOW()');
    console.log('Connected to PostgreSQL');

    await pgPool.query(\`
      CREATE TABLE IF NOT EXISTS short_codes (
        short_code VARCHAR(10) UNIQUE NOT NULL PRIMARY KEY,
        used BOOLEAN DEFAULT FALSE
      )
    \`);

    await pgPool.query(\`
      CREATE INDEX IF NOT EXISTS idx_short_code ON short_codes(short_code)
    \`);

    const result = await pgPool.query('SELECT COUNT(*) FROM short_codes');

    if (parseInt(result.rows[0].count, 10) < 1000) {
      console.log('Seeding short codes...');

      const seedCount = 1000;
      const seedValues = Array.from({ length: seedCount }, (_, i) => \`('\${nanoid(8)}', false)\`).join(',');

      await pgPool.query(\`
        INSERT INTO short_codes (short_code, used)
        VALUES \${seedValues}
        ON CONFLICT (short_code) DO NOTHING
      \`);
    } else {
      console.log('Plenty of short codes available, skipping seed.'); 
    }

    // Initialize CouchDB database
    try {
      await couchdb.db.create('tiny_urls');
      await couchdb.use('tiny_urls').createIndex({
        index: { fields: ['shortCode', 'created_at', 'long_url'] },
        name: 'short_code_created_at_index',
      });

      await couchdb.use('tiny_urls').createIndex({
        index: { fields: ['created_at'] },
        name: 'created_at_index',
      }); 

      await couchdb.use('tiny_urls').createIndex({
        index: { fields: ['long_url'] },
        name: 'long_url_index',
      });
    } catch (err) {
      if (err.statusCode !== 412) { // 412 means database already exists
        console.error('Error creating CouchDB database:', err);
      }
    }
    console.log('Connected to CouchDB');

  } catch (err) {
    console.error('Connection error:', err);
    process.exit(1);
  }
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      postgres: false,
      redis: false,
      couchdb: false
    }
  };

  try {
    await pgPool.query('SELECT 1');
    health.services.postgres = true;
  } catch (err) {
    health.status = 'unhealthy';
  }

  try {
    await redisClient.ping();
    health.services.redis = true;
  } catch (err) {
    health.status = 'unhealthy';
  }

  try {
    await couchdb.db.list();
    health.services.couchdb = true;
  } catch (err) {
    health.status = 'unhealthy';
  }

  res.status(health.status === 'healthy' ? 200 : 503).json(health);
});

// Create short URL
app.post('/api/shorten', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // Seelect a short code from PostgreSQL
    let shortCode;

    try {
      await pgPool.query('BEGIN'); 

      const shortCodeResult = await pgPool.query(
        'SELECT short_code FROM short_codes WHERE used = false LIMIT 1'
      );

      await pgPool.query('UPDATE short_codes SET used = true WHERE short_code = \$1', [shortCodeResult.rows[0].short_code]);

      await pgPool.query('COMMIT');

      if (shortCodeResult.rows.length === 0) {
        return res.status(500).json({ error: 'No available short codes' });
      }

      shortCode = shortCodeResult.rows[0].short_code;
      
    } catch (err) {
      await pgPool.query('ROLLBACK');

      console.error('Error generating short code:', err);
      return res.status(500).json({ error: 'Failed to generate short code' });
    }

    // Cache in Redis with TTL of 1 hour
    await redisClient.setEx(\`url:\${shortCode}\`, 3600, url);

    // Store urls in CouchDB
    const urls = couchdb.use('tiny_urls');
    await urls.insert({
      shortCode: shortCode,
      created_at: new Date().toISOString(),
      long_url: url,
      ip: req.ip
    });

    res.json({
      shortUrl: \`http://localhost/\${shortCode}\`,
      shortCode,
      longUrl: url
    });
  } catch (err) {
    console.error('Error creating short URL:', err);
    res.status(500).json({ error: 'Failed to create short URL' });
  }
});

// Redirect to long URL
app.get('/:shortCode', async (req, res) => {
  const { shortCode } = req.params;

  try {
    // Check Redis cache first
    const cachedUrl = await redisClient.get(\`url:\${shortCode}\`);
    
    if (cachedUrl) {
      return res.redirect(cachedUrl);
    }

    // If not in cache, check CouchDB
    const result = await couchdb.use('tiny_urls').find({
      selector: { shortCode: shortCode },
      fields: ['long_url'],
    });

    if (result.docs.length === 0) {
      return res.status(404).json({ error: 'Short URL not found' });
    }

    const longUrl = result.docs[0].long_url;
    
    // Update cache
    await redisClient.setEx(\`url:\${shortCode}\`, 3600, longUrl);

    res.redirect(longUrl);
  } catch (err) {
    console.error('Error redirecting:', err);
    res.status(500).json({ error: 'Failed to redirect' });
  }
});

// List all URLs
app.get('/api/urls', async (req, res) => {
  try {
    const result = await couchdb.use('tiny_urls').list({include_docs: true})
  
    // console.log('Result:', result);
    res.json(result.rows.map(({doc}) => ({
      shortCode: doc.shortCode,
      longUrl: doc.long_url,
    })));

  } catch (err) {
    console.error('Error listing URLs:', err);
    res.status(500).json({ error: 'Failed to list URLs' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;

initializeConnections().then(() => {
  app.listen(PORT, () => {
    console.log(\`Server running on port \${PORT}\`);
  });
});
SERVEREOF

# Install dependencies
echo "Installing npm dependencies..."
npm install 2>&1

# Create environment file
echo "Creating environment file..."
cat > /opt/app/.env <<ENVEOF
NODE_ENV=production
PORT=3000
POSTGRES_HOST=${pgHost}
POSTGRES_PORT=${pgPort}
POSTGRES_DB=${args.postgresDbName}
POSTGRES_USER=${args.postgresUsername}
POSTGRES_PASSWORD=${pgPassword}
REDIS_HOST=${redisHost}
REDIS_PORT=6379
COUCHDB_HOST=${couchdbHost}
COUCHDB_PORT=5984
COUCHDB_USER=admin
COUCHDB_PASSWORD=\$COUCHDB_PASSWORD
ENVEOF

# Debug environment
echo "Environment variables:"
cat /opt/app/.env

# Create systemd service
echo "Creating systemd service..."
cat > /etc/systemd/system/nodeapp.service <<SERVICEEOF
[Unit]
Description=TinyURL API Server
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/app
EnvironmentFile=/opt/app/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICEEOF

# Set proper permissions
echo "Setting permissions..."
chown -R ec2-user:ec2-user /opt/app

# Start and enable the service
echo "Starting Node.js service..."
systemctl daemon-reload
systemctl enable nodeapp
systemctl start nodeapp

# Wait for service to start
echo "Waiting for service to start..."
sleep 10

# Check service status
echo "Checking service status..."
systemctl status nodeapp

# Test the service
echo "Testing health endpoint..."
for i in {1..5}; do
    if curl -f http://localhost:3000/health; then
        echo "Health check passed!"
        break
    else
        echo "Health check attempt \$i failed, waiting..."
        sleep 5
    fi
done

# Final status
echo "Final service status:"
systemctl status nodeapp
journalctl -u nodeapp -n 50

echo "User data script completed at $(date)"
`;
        });

        // Create target group
        const targetGroup = new aws.lb.TargetGroup(`${name}-tg`, {
            name: `${args.projectName}-app-tg`,
            port: 3000,
            protocol: "HTTP",
            vpcId: args.vpcId,
            healthCheck: {
                enabled: true,
                healthyThreshold: 2,
                unhealthyThreshold: 2,
                timeout: 5,
                interval: 30,
                path: "/health",
                matcher: "200",
            },
            tags: {
                Name: `${args.projectName}-app-tg`,
                Environment: args.environment,
            },
        }, { parent: this });

        // Create IAM role for EC2 instances
        const role = new aws.iam.Role(`${name}-role`, {
            assumeRolePolicy: JSON.stringify({
                Version: "2012-10-17",
                Statement: [{
                    Action: "sts:AssumeRole",
                    Effect: "Allow",
                    Principal: {
                        Service: "ec2.amazonaws.com",
                    },
                }],
            }),
            tags: {
                Name: `${args.projectName}-app-role`,
                Environment: args.environment,
            },
        }, { parent: this });

        // Create IAM policy for SSM access and CloudWatch logs
        const ssmPolicy = new aws.iam.Policy(`${name}-ssm-policy`, {
            policy: JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Action: [
                            "ssm:GetParameter",
                            "ssm:GetParameters",
                        ],
                        Resource: `arn:aws:ssm:*:*:parameter/${args.projectName}/${args.environment}/*`,
                    },
                    {
                        Effect: "Allow",
                        Action: [
                            "logs:CreateLogGroup",
                            "logs:CreateLogStream",
                            "logs:PutLogEvents",
                            "logs:DescribeLogStreams"
                        ],
                        Resource: "*",
                    },
                    {
                        Effect: "Allow",
                        Action: [
                            "ec2:DescribeVolumes",
                            "ec2:DescribeTags",
                            "ec2:DescribeInstances"
                        ],
                        Resource: "*",
                    }
                ],
            }),
        }, { parent: this });

        // Attach policy to role
        new aws.iam.RolePolicyAttachment(`${name}-ssm-policy-attachment`, {
            role: role.name,
            policyArn: ssmPolicy.arn,
        }, { parent: this });

        // Attach AWS managed policy for SSM Session Manager
        new aws.iam.RolePolicyAttachment(`${name}-ssm-session-manager-attachment`, {
            role: role.name,
            policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
        }, { parent: this });

        // Create instance profile
        const instanceProfile = new aws.iam.InstanceProfile(`${name}-profile`, {
            role: role.name,
            tags: {
                Name: `${args.projectName}-app-profile`,
                Environment: args.environment,
            },
        }, { parent: this });

        // Create launch template
        const launchTemplate = new aws.ec2.LaunchTemplate(`${name}-lt`, {
            namePrefix: `${args.projectName}-app-`,
            imageId: ami.then(a => a.id),
            instanceType: args.instanceType,
            vpcSecurityGroupIds: [args.securityGroupId],
            iamInstanceProfile: {
                arn: instanceProfile.arn,
            },
            userData: userData.apply(u => Buffer.from(u).toString('base64')),
            blockDeviceMappings: [{
                deviceName: "/dev/xvda",
                ebs: {
                    volumeSize: 20,
                    volumeType: "gp3",
                    encrypted: 'true',
                },
            }],
            tagSpecifications: [{
                resourceType: "instance",
                tags: {
                    Name: `${args.projectName}-app-instance`,
                    Environment: args.environment,
                },
            }],
        }, { parent: this });

        // Create auto scaling group
        const asg = new aws.autoscaling.Group(`${name}-asg`, {
            name: `${args.projectName}-app-asg`,
            vpcZoneIdentifiers: args.subnetIds,
            targetGroupArns: [targetGroup.arn],
            healthCheckType: "ELB",
            healthCheckGracePeriod: 300,
            minSize: args.minSize,
            maxSize: args.maxSize,
            desiredCapacity: args.desiredCapacity,
            launchTemplate: {
                id: launchTemplate.id,
                version: "$Latest",
            },
            tags: [
                {
                    key: "Name",
                    value: `${args.projectName}-app-asg`,
                    propagateAtLaunch: false,
                },
                {
                    key: "Environment",
                    value: args.environment,
                    propagateAtLaunch: true,
                },
            ],
        }, { parent: this });

        // Create scaling policies
        const scaleUpPolicy = new aws.autoscaling.Policy(`${name}-scale-up`, {
            name: `${args.projectName}-scale-up`,
            scalingAdjustment: 1,
            adjustmentType: "ChangeInCapacity",
            cooldown: 300,
            autoscalingGroupName: asg.name,
        }, { parent: this });

        const scaleDownPolicy = new aws.autoscaling.Policy(`${name}-scale-down`, {
            name: `${args.projectName}-scale-down`,
            scalingAdjustment: -1,
            adjustmentType: "ChangeInCapacity",
            cooldown: 300,
            autoscalingGroupName: asg.name,
        }, { parent: this });

        // Create CloudWatch alarms
        new aws.cloudwatch.MetricAlarm(`${name}-cpu-high`, {
            // alarmName: `${args.projectName}-cpu-high`,
            comparisonOperator: "GreaterThanThreshold",
            evaluationPeriods: 2,
            metricName: "CPUUtilization",
            namespace: "AWS/EC2",
            period: 300,
            statistic: "Average",
            threshold: 80,
            alarmDescription: "This metric monitors EC2 cpu utilization",
            dimensions: {
                AutoScalingGroupName: asg.name,
            },
            alarmActions: [scaleUpPolicy.arn],
        }, { parent: this });

        new aws.cloudwatch.MetricAlarm(`${name}-cpu-low`, {
            // alarmName: `${args.projectName}-cpu-low`,
            comparisonOperator: "LessThanThreshold",
            evaluationPeriods: 2,
            metricName: "CPUUtilization",
            namespace: "AWS/EC2",
            period: 300,
            statistic: "Average",
            threshold: 20,
            alarmDescription: "This metric monitors EC2 cpu utilization",
            dimensions: {
                AutoScalingGroupName: asg.name,
            },
            alarmActions: [scaleDownPolicy.arn],
        }, { parent: this });

        this.asgName = asg.name;
        this.asgId = asg.id;
        this.targetGroupArn = targetGroup.arn;
        this.launchTemplateId = launchTemplate.id;

        this.registerOutputs({
            asgName: this.asgName,
            asgId: this.asgId,
            targetGroupArn: this.targetGroupArn,
            launchTemplateId: this.launchTemplateId,
        });
    }
}