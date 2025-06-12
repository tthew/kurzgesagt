import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as random from '@pulumi/random'

export interface CouchDBArgs {
    projectName: string;
    environment: string;
    vpcId: pulumi.Input<string>;
    subnetId: pulumi.Input<string>;
    securityGroupId: pulumi.Input<string>;
    instanceType: string;
}

export class CouchDB extends pulumi.ComponentResource {
    public readonly endpoint: pulumi.Output<string>;
    public readonly instanceId: pulumi.Output<string>;
    public readonly privateIp: pulumi.Output<string>;

    constructor(name: string, args: CouchDBArgs, opts?: pulumi.ComponentResourceOptions) {
        super("tinyurl:components:CouchDB", name, {}, opts);

        // Get latest Ubuntu AMI
        const ami = aws.ec2.getAmi({
            mostRecent: true,
            owners: ["099720109477"], // Canonical
            filters: [
                {
                    name: "name",
                    values: ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"],
                },
                {
                    name: "virtualization-type",
                    values: ["hvm"],
                },
            ],
        });

        // Generate admin password (URL-safe characters only)
        const adminPassword = new random.RandomPassword(`${name}-admin-password`, {
            length: 32,
            special: false,
            upper: true,
            lower: true,
            numeric: true,
        }, { parent: this });

        // Store password in SSM Parameter Store
        new aws.ssm.Parameter(`${name}-admin-password-param`, {
            name: `/${args.projectName}/${args.environment}/couchdb/admin_password`,
            type: "SecureString",
            value: adminPassword.result,
            tags: {
                Environment: args.environment,
            },
        }, { parent: this });

        // User data script
        const userData = pulumi.interpolate`#!/bin/bash -x
exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "Starting CouchDB installation at $(date)"

# Update system
echo "Updating system packages..."
apt-get update -y

# Install Docker
echo "Installing Docker..."
apt-get install -y docker.io
systemctl start docker
systemctl enable docker

# Pull and run CouchDB container
echo "Running CouchDB in Docker..."
COUCHDB_PASS='${adminPassword.result}'
docker run -d \
  --name couchdb \
  --restart always \
  -p 5984:5984 \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD="\$COUCHDB_PASS" \
  -v /opt/couchdb/data:/opt/couchdb/data \
  apache/couchdb:3.3

# Wait for CouchDB to start
echo "Waiting for CouchDB to start..."
for i in {1..30}; do
    if curl -s http://localhost:5984/ > /dev/null; then
        echo "CouchDB is responding!"
        break
    fi
    echo "Waiting for CouchDB... attempt \$i"
    sleep 2
done

# Configure CouchDB
echo "Configuring CouchDB..."
sleep 10

# Set up single node (using basic auth with proper escaping)
echo "Setting up CouchDB as single node..."
curl -X PUT "http://localhost:5984/_node/_local/_config/couchdb/single_node" \
  -u "admin:\$COUCHDB_PASS" \
  -H "Content-Type: application/json" \
  -d '"true"'

# Initialize system databases
echo "Initializing CouchDB system databases..."
curl -X PUT "http://localhost:5984/_users" -u "admin:\$COUCHDB_PASS"
curl -X PUT "http://localhost:5984/_replicator" -u "admin:\$COUCHDB_PASS"
curl -X PUT "http://localhost:5984/_global_changes" -u "admin:\$COUCHDB_PASS"

# Verify CouchDB is working
echo "Verifying CouchDB..."
curl "http://localhost:5984/" -u "admin:\$COUCHDB_PASS"

# Check Docker container status
docker ps -a | grep couchdb

echo "CouchDB installation completed at $(date)"
`;

        // Create IAM role for EC2 instance
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
        }, { parent: this });

        // Attach SSM policy for Session Manager
        new aws.iam.RolePolicyAttachment(`${name}-ssm-policy`, {
            role: role.name,
            policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
        }, { parent: this });

        // Create instance profile
        const instanceProfile = new aws.iam.InstanceProfile(`${name}-profile`, {
            role: role.name,
        }, { parent: this });

        // Create EC2 instance
        const instance = new aws.ec2.Instance(`${name}-instance`, {
            ami: ami.then(a => a.id),
            instanceType: args.instanceType,
            subnetId: args.subnetId,
            vpcSecurityGroupIds: [args.securityGroupId],
            iamInstanceProfile: instanceProfile.name,
            userData: userData,
            rootBlockDevice: {
                volumeSize: 30,
                volumeType: "gp3",
                encrypted: true,
            },
            tags: {
                Name: `${args.projectName}-couchdb`,
                Environment: args.environment,
            },
        }, { parent: this });

        this.instanceId = instance.id;
        this.privateIp = instance.privateIp;
        this.endpoint = pulumi.interpolate`http://${instance.privateIp}:5984`;

        this.registerOutputs({
            endpoint: this.endpoint,
            instanceId: this.instanceId,
            privateIp: this.privateIp,
        });
    }
}