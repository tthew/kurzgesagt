# TinyURL Infrastructure: AWS/IaC/DevOps Deep Dive for Senior Engineers

This guide targets senior software engineers who need to understand AWS cloud infrastructure, Infrastructure as Code (IaC), and DevOps practices without over-explaining general software engineering concepts.

## Table of Contents

1. [Infrastructure as Code: Beyond Configuration Management](#infrastructure-as-code-beyond-configuration-management)
2. [AWS Mental Models: How Cloud Infrastructure Differs](#aws-mental-models-how-cloud-infrastructure-differs)
3. [Pulumi vs Other IaC Tools: Technical Trade-offs](#pulumi-vs-other-iac-tools-technical-trade-offs)
4. [AWS Networking: The Complete Picture](#aws-networking-the-complete-picture)
5. [Auto Scaling and Load Balancing: Production Patterns](#auto-scaling-and-load-balancing-production-patterns)
6. [AWS Security Model: IAM, VPC, and Encryption](#aws-security-model-iam-vpc-and-encryption)
7. [Managed Services vs Self-Hosted: Decision Framework](#managed-services-vs-self-hosted-decision-framework)
8. [DevOps Practices: CI/CD, Monitoring, and Operations](#devops-practices-cicd-monitoring-and-operations)

---

## Infrastructure as Code: Beyond Configuration Management

### The IaC Paradigm Shift

As a senior engineer, you're familiar with configuration management tools like Ansible, Chef, or Puppet. IaC represents a fundamental shift in abstraction level:

**Configuration Management (Server-Centric)**:
```yaml
# Ansible playbook
- name: Install nginx
  package:
    name: nginx
    state: present
- name: Configure nginx
  template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
```

**Infrastructure as Code (Resource-Centric)**:
```typescript
// Pulumi/TypeScript
const webServer = new aws.ec2.Instance("web", {
    ami: "ami-12345678",
    instanceType: "t3.micro",
    userData: nginxInstallScript,
});

const loadBalancer = new aws.lb.LoadBalancer("alb", {
    loadBalancerType: "application",
    subnets: vpc.publicSubnetIds,
});
```

### Key Differences for Infrastructure

1. **Declarative vs Imperative**: IaC describes the desired end state, not the steps to achieve it
2. **Immutable Infrastructure**: Replace rather than modify resources
3. **Resource Dependencies**: Tools understand relationships between resources
4. **State Management**: IaC tools track what exists vs what should exist

### Pulumi's Type System Advantage

```typescript
// Compile-time safety - this won't compile
const instance = new aws.ec2.Instance("web", {
    instanceType: "invalid-type",  // TypeScript error
    ami: 12345,                    // Type error: string expected
});

// Output types ensure correct usage
const dbEndpoint: pulumi.Output<string> = rdsInstance.endpoint;
const connectionString = pulumi.interpolate`postgres://${dbEndpoint}/mydb`;
```

Compare to Terraform (no compile-time checking):
```hcl
resource "aws_instance" "web" {
  instance_type = "invalid-type"  # Runtime error only
  ami          = 12345           # Runtime error only
}
```

### State Management Deep Dive

IaC tools maintain a "state file" that maps your code to real AWS resources:

```typescript
// Pulumi stack state (conceptual)
{
  "resources": [
    {
      "urn": "urn:pulumi:dev::tinyurl::aws:ec2/instance:Instance::web",
      "id": "i-0123456789abcdef0",
      "inputs": { "instanceType": "t3.micro" },
      "outputs": { "publicIp": "1.2.3.4" }
    }
  ]
}
```

**State Challenges**:
- **Drift Detection**: What if someone manually changes resources?
- **Concurrent Modifications**: Multiple developers deploying simultaneously
- **State Corruption**: Backup and recovery strategies

**Pulumi's Approach**:
```bash
# Detect drift
pulumi refresh

# Show differences
pulumi preview --diff

# Resolve conflicts
pulumi up --target urn:pulumi:dev::tinyurl::aws:ec2/instance:Instance::web
```

---

## AWS Mental Models: How Cloud Infrastructure Differs

### From Physical to Virtual: The Abstraction Layers

Traditional on-premises thinking doesn't directly translate to cloud. Here are the key mental model shifts:

#### Physical Servers → EC2 Instances
```typescript
// Not just "a server" - it's a configuration template
const instance = new aws.ec2.Instance("app", {
    ami: "ami-12345",           // Operating system image
    instanceType: "t3.medium",  // CPU/memory configuration
    keyName: "my-keypair",      // SSH access
    subnetId: privateSubnet.id, // Network placement
    securityGroupIds: [sg.id],  // Firewall rules
    userData: bootScript,       // Initialization script
    
    // Persistence and backup
    rootBlockDevice: {
        volumeSize: 20,
        volumeType: "gp3",
        encrypted: true,
        deleteOnTermination: true,
    },
    
    // Instance lifecycle
    disableApiTermination: false,
    instanceInitiatedShutdownBehavior: "stop",
});
```

**Key Concepts**:
- **AMI (Amazon Machine Image)**: Like a VM template, but immutable
- **Instance Types**: Hardware configurations (compute-optimized, memory-optimized, etc.)
- **User Data**: Cloud-init script that runs on first boot
- **Instance Store vs EBS**: Temporary vs persistent storage

#### Data Centers → Availability Zones & Regions

```typescript
// Geographic distribution for resilience
const regions = {
    primary: "us-east-1",     // N. Virginia
    secondary: "us-west-2",   // Oregon
};

const availabilityZones = {
    "us-east-1": ["us-east-1a", "us-east-1b", "us-east-1c"],
    // Each AZ is a separate data center building
};
```

**Design Implications**:
- **Single AZ**: Risk of data center failure
- **Multi-AZ**: Higher availability, slight latency increase
- **Multi-Region**: Disaster recovery, compliance requirements

#### Network Hardware → VPC and Subnets

Traditional network thinking:
```
VLAN 100: 192.168.1.0/24 (DMZ)
VLAN 200: 192.168.2.0/24 (Internal)
Router with ACLs between VLANs
```

AWS equivalent:
```typescript
const vpc = new awsx.ec2.Vpc("main", {
    cidrBlock: "10.0.0.0/16",
    numberOfAvailabilityZones: 2,
});

// Public subnet = DMZ equivalent
vpc.publicSubnetIds   // Can reach internet directly

// Private subnet = Internal network equivalent  
vpc.privateSubnetIds  // Outbound only via NAT Gateway
```

### AWS Service Categories and Selection Criteria

#### Compute Services Decision Tree

```typescript
// Question: Do you need full OS control?
if (needFullOSControl) {
    // EC2 instances
    const server = new aws.ec2.Instance("app", { ... });
} else if (containerWorkload) {
    // Container services
    if (needKubernetes) {
        // EKS (Elastic Kubernetes Service)
        const cluster = new aws.eks.Cluster("k8s", { ... });
    } else {
        // ECS (Elastic Container Service) or Fargate
        const service = new aws.ecs.Service("app", { ... });
    }
} else if (eventDriven || shortRunning) {
    // Lambda functions
    const func = new aws.lambda.Function("handler", { ... });
}
```

#### Storage Services by Use Case

```typescript
// Block storage (like mounting a hard drive)
const volume = new aws.ebs.Volume("data", {
    size: 100,
    type: "gp3",
    // Use for: Database files, file systems
});

// Object storage (like a file API)
const bucket = new aws.s3.Bucket("uploads", {
    // Use for: Static files, backups, data lakes
});

// Network file system
const efs = new aws.efs.FileSystem("shared", {
    // Use for: Shared data between instances
});
```

#### Database Services Decision Matrix

```typescript
// Relational databases
if (needSQL && wantManaged) {
    const db = new aws.rds.Instance("postgres", {
        engine: "postgres",
        // AWS handles: backups, patching, monitoring, failover
    });
} else if (needSQL && needFullControl) {
    // Self-managed on EC2
    const dbServer = new aws.ec2.Instance("db", { ... });
}

// NoSQL databases
if (needDocumentDB) {
    const docDB = new aws.dynamodb.Table("docs", {
        // Fully managed, serverless scaling
    });
} else if (needGraphDB) {
    const neptune = new aws.neptune.Cluster("graph", { ... });
}

// Caching
const cache = new aws.elasticache.Cluster("redis", {
    engine: "redis",
    // Managed Redis/Memcached
});
```

---

## Pulumi vs Other IaC Tools: Technical Trade-offs

### Language and Ecosystem Comparison

#### Terraform (HCL)
```hcl
variable "instance_count" {
  type    = number
  default = 3
}

resource "aws_instance" "web" {
  count         = var.instance_count
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"
  
  tags = {
    Name = "web-${count.index}"
  }
}

# Limited programming constructs
# No real functions, classes, or modules
```

#### AWS CloudFormation (YAML/JSON)
```yaml
Parameters:
  InstanceCount:
    Type: Number
    Default: 3

Resources:
  WebServerGroup:
    Type: AWS::AutoScaling::AutoScalingGroup
    Properties:
      LaunchTemplate:
        LaunchTemplateId: !Ref LaunchTemplate
        Version: !GetAtt LaunchTemplate.LatestVersionNumber
      MinSize: !Ref InstanceCount
      MaxSize: !Ref InstanceCount
      
# Verbose, limited logic, AWS-only
```

#### Pulumi (TypeScript)
```typescript
interface WebServerConfig {
    instanceCount: number;
    instanceType: aws.ec2.InstanceType;
    enableMonitoring: boolean;
}

class WebServerCluster extends pulumi.ComponentResource {
    constructor(name: string, config: WebServerConfig, opts?: pulumi.ComponentResourceOptions) {
        super("custom:WebServerCluster", name, {}, opts);
        
        // Full programming language capabilities
        const instances = Array.from({ length: config.instanceCount }, (_, i) => {
            return new aws.ec2.Instance(`${name}-${i}`, {
                instanceType: config.instanceType,
                ami: this.getLatestAMI(),
                monitoring: config.enableMonitoring,
                userData: this.generateUserData(i),
            }, { parent: this });
        });
        
        // Can use npm packages, testing frameworks, etc.
        this.loadBalancer = new aws.lb.LoadBalancer(`${name}-alb`, {
            // Complex logic using full language features
        }, { parent: this });
    }
    
    private getLatestAMI(): pulumi.Input<string> {
        // Custom methods, proper abstraction
    }
}
```

### State Management Comparison

#### Terraform State
```bash
# Terraform state is a single JSON file
terraform.tfstate
{
  "version": 4,
  "terraform_version": "1.0.0",
  "resources": [...]
}

# Challenges:
# - State locking (DynamoDB table required)
# - Remote state configuration
# - State file corruption risk
# - No built-in encryption
```

#### Pulumi State
```bash
# Pulumi service (SaaS) or self-hosted backend
pulumi stack ls
dev     2024-01-15T10:30:00Z  50 resources

# Features:
# - Built-in concurrency protection
# - Automatic encryption
# - Stack history and rollback
# - Policy as code integration
```

### Resource Relationship Handling

#### Terraform's Dependency Management
```hcl
# Manual dependency specification required
resource "aws_instance" "web" {
  depends_on = [aws_security_group.web_sg]
}

# Implicit dependencies through references
resource "aws_instance" "web" {
  vpc_security_group_ids = [aws_security_group.web_sg.id]
}
```

#### Pulumi's Automatic Dependencies
```typescript
// Dependencies automatically inferred
const sg = new aws.ec2.SecurityGroup("web-sg", { ... });
const instance = new aws.ec2.Instance("web", {
    vpcSecurityGroupIds: [sg.id],  // Pulumi tracks this dependency
});

// Outputs handle async nature of cloud resources
const endpoint = pulumi.interpolate`http://${instance.publicIp}:8080`;
```

---

## AWS Networking: The Complete Picture

### VPC: Your Private Cloud Network

Think of VPC as creating your own network within AWS's data centers:

```typescript
const vpc = new awsx.ec2.Vpc("tinyurl-vpc", {
    cidrBlock: "10.0.0.0/16",              // Your IP address space
    numberOfAvailabilityZones: 2,          // Spread across 2 data centers
    enableDnsHostnames: true,               // EC2 instances get DNS names
    enableDnsSupport: true,                 // Enable DNS resolution
});
```

**What this creates under the hood**:
1. **VPC**: The network container
2. **Internet Gateway**: Route to the internet
3. **Subnets**: Network segments within each AZ
4. **Route Tables**: Traffic routing rules
5. **NAT Gateways**: Outbound internet for private subnets

### Subnet Architecture Patterns

#### Public Subnets (Internet-facing)
```typescript
// Created automatically by awsx.ec2.Vpc
// Manual equivalent:
const publicSubnet = new aws.ec2.Subnet("public", {
    vpcId: vpc.id,
    cidrBlock: "10.0.1.0/24",
    availabilityZone: "us-east-1a",
    mapPublicIpOnLaunch: true,              // Auto-assign public IPs
});

const routeTable = new aws.ec2.RouteTable("public", {
    vpcId: vpc.id,
    routes: [{
        cidrBlock: "0.0.0.0/0",
        gatewayId: internetGateway.id,       // Route to internet
    }],
});
```

**Use cases**: Load balancers, NAT gateways, bastion hosts

#### Private Subnets (Internal only)
```typescript
const privateSubnet = new aws.ec2.Subnet("private", {
    vpcId: vpc.id,
    cidrBlock: "10.0.100.0/24",
    availabilityZone: "us-east-1a",
    mapPublicIpOnLaunch: false,             // No public IPs
});

const privateRouteTable = new aws.ec2.RouteTable("private", {
    vpcId: vpc.id,
    routes: [{
        cidrBlock: "0.0.0.0/0",
        natGatewayId: natGateway.id,         // Outbound via NAT
    }],
});
```

**Use cases**: Application servers, databases, internal services

### Security Groups vs NACLs: Firewall Comparison

```typescript
// Security Groups (Stateful - like iptables with connection tracking)
const webSG = new aws.ec2.SecurityGroup("web", {
    ingress: [{
        fromPort: 80,
        toPort: 80,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"],           // Allow HTTP from anywhere
    }],
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],           // Allow all outbound
    }],
});

// Network ACLs (Stateless - like traditional router ACLs)
const nacl = new aws.ec2.NetworkAcl("restrictive", {
    vpcId: vpc.id,
    ingress: [{
        rule_no: 100,
        protocol: "tcp",
        from_port: 80,
        to_port: 80,
        cidr_block: "0.0.0.0/0",
        action: "allow",
    }],
    egress: [{
        rule_no: 100,
        protocol: "tcp",
        from_port: 32768,                    // Ephemeral ports for return traffic
        to_port: 65535,
        cidr_block: "0.0.0.0/0",
        action: "allow",
    }],
});
```

**Security Groups vs NACLs**:
- **Security Groups**: Apply to instances, stateful, allow rules only
- **NACLs**: Apply to subnets, stateless, allow and deny rules

### Advanced Networking Patterns

#### VPC Peering for Multi-Environment
```typescript
// Connect staging and production VPCs
const peeringConnection = new aws.ec2.VpcPeeringConnection("staging-to-prod", {
    vpcId: stagingVpc.id,
    peerVpcId: productionVpc.id,
    autoAccept: true,
});

// Update route tables to allow cross-VPC traffic
const crossVpcRoute = new aws.ec2.Route("staging-to-prod-route", {
    routeTableId: stagingRouteTable.id,
    destinationCidrBlock: "10.1.0.0/16",    // Production VPC CIDR
    vpcPeeringConnectionId: peeringConnection.id,
});
```

#### VPC Endpoints for AWS Services
```typescript
// Private connection to S3 (no internet required)
const s3Endpoint = new aws.ec2.VpcEndpoint("s3", {
    vpcId: vpc.id,
    serviceName: "com.amazonaws.us-east-1.s3",
    vpcEndpointType: "Gateway",              // Gateway vs Interface
    routeTableIds: [privateRouteTable.id],
});

// Interface endpoint for EC2 API
const ec2Endpoint = new aws.ec2.VpcEndpoint("ec2", {
    vpcId: vpc.id,
    serviceName: "com.amazonaws.us-east-1.ec2",
    vpcEndpointType: "Interface",
    subnetIds: vpc.privateSubnetIds,
    securityGroupIds: [endpointSG.id],
});
```

---

## Auto Scaling and Load Balancing: Production Patterns

### Load Balancer Types and Use Cases

#### Application Load Balancer (Layer 7)
```typescript
const alb = new aws.lb.LoadBalancer("app-lb", {
    loadBalancerType: "application",         // HTTP/HTTPS aware
    subnets: vpc.publicSubnetIds,
    securityGroups: [albSG.id],
    
    // Advanced features
    enableDeletionProtection: true,          // Production safety
    enableHttp2: true,                       // Performance optimization
    idleTimeout: 60,                         // Connection timeout
    
    accessLogs: {                            // Debugging and analytics
        bucket: logsBucket.id,
        enabled: true,
        prefix: "alb-logs",
    },
});

// Path-based routing
const listener = new aws.lb.Listener("http", {
    loadBalancerArn: alb.arn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [{
        type: "forward",
        targetGroupArn: defaultTG.arn,
    }],
});

// Multiple target groups for microservices
const apiRule = new aws.lb.ListenerRule("api-route", {
    listenerArn: listener.arn,
    priority: 100,
    conditions: [{
        pathPattern: { values: ["/api/*"] },
    }],
    actions: [{
        type: "forward",
        targetGroupArn: apiTG.arn,
    }],
});
```

#### Network Load Balancer (Layer 4)
```typescript
const nlb = new aws.lb.LoadBalancer("tcp-lb", {
    loadBalancerType: "network",             // TCP/UDP
    scheme: "internal",                      // Internal load balancer
    subnets: vpc.privateSubnetIds,
    
    // High performance, lower latency
    enableCrossZoneLoadBalancing: true,
});

// TCP listener for database connections
const tcpListener = new aws.lb.Listener("tcp", {
    loadBalancerArn: nlb.arn,
    port: 5432,
    protocol: "TCP",
    defaultActions: [{
        type: "forward",
        targetGroupArn: dbTG.arn,
    }],
});
```

### Auto Scaling Deep Dive

#### Launch Templates vs Launch Configurations
```typescript
// Modern approach: Launch Templates (more flexible)
const launchTemplate = new aws.ec2.LaunchTemplate("app", {
    imageId: ami.id,
    instanceType: "t3.medium",
    keyName: "my-key",
    
    // Network configuration
    vpcSecurityGroupIds: [appSG.id],
    
    // Multiple instance types for Spot instances
    instanceMarketOptions: {
        marketType: "spot",
        spotOptions: {
            maxPrice: "0.10",
            spotInstanceType: "one-time",
        },
    },
    
    // Block device configuration
    blockDeviceMappings: [{
        deviceName: "/dev/xvda",
        ebs: {
            volumeSize: 20,
            volumeType: "gp3",
            iops: 3000,                      // Provisioned IOPS
            throughput: 125,                 // MiB/s
            encrypted: true,
        },
    }],
    
    // User data script
    userData: pulumi.interpolate`#!/bin/bash
        yum update -y
        ${deploymentScript}
    `.apply(script => Buffer.from(script).toString('base64')),
    
    // IAM instance profile
    iamInstanceProfile: { name: instanceProfile.name },
    
    // Monitoring
    monitoring: { enabled: true },
    
    // Instance metadata service v2 (security)
    metadataOptions: {
        httpEndpoint: "enabled",
        httpTokens: "required",              // Require IMDSv2
        httpPutResponseHopLimit: 1,
    },
});
```

#### Auto Scaling Policies and Metrics

```typescript
// Target tracking scaling (recommended)
const targetTracking = new aws.autoscaling.Policy("target-cpu", {
    autoscalingGroupName: asg.name,
    policyType: "TargetTrackingScaling",
    targetTrackingConfiguration: {
        targetValue: 70.0,                   // Target CPU utilization
        predefinedMetricSpecification: {
            predefinedMetricType: "ASGAverageCPUUtilization",
        },
        scaleOutCooldown: 300,               // 5 minutes
        scaleInCooldown: 300,
    },
});

// Step scaling for more control
const stepScaling = new aws.autoscaling.Policy("step-scaling", {
    autoscalingGroupName: asg.name,
    policyType: "StepScaling",
    adjustmentType: "ChangeInCapacity",
    metricAggregationType: "Average",
    stepAdjustments: [
        {
            metricIntervalLowerBound: 0,
            metricIntervalUpperBound: 50,
            scalingAdjustment: 1,            // Add 1 instance
        },
        {
            metricIntervalLowerBound: 50,
            scalingAdjustment: 2,            // Add 2 instances
        },
    ],
});

// Custom metric scaling
const customMetric = new aws.cloudwatch.MetricAlarm("custom-alarm", {
    metricName: "QueueLength",
    namespace: "MyApp",
    statistic: "Average",
    period: 300,
    evaluationPeriods: 2,
    threshold: 10,
    comparisonOperator: "GreaterThanThreshold",
    alarmActions: [stepScaling.arn],
});
```

### Health Checks and Fault Tolerance

```typescript
const targetGroup = new aws.lb.TargetGroup("app-tg", {
    port: 8080,
    protocol: "HTTP",
    vpcId: vpc.id,
    targetType: "instance",
    
    // Health check configuration
    healthCheck: {
        enabled: true,
        path: "/health",                     // Application health endpoint
        port: "traffic-port",                // Same port as traffic
        protocol: "HTTP",
        
        // Timing configuration
        intervalSeconds: 30,                 // Check every 30 seconds
        timeoutSeconds: 5,                   // 5 second timeout
        healthyThresholdCount: 2,            // 2 consecutive successes = healthy
        unhealthyThresholdCount: 3,          // 3 consecutive failures = unhealthy
        
        // Health check criteria
        matcher: "200",                      // Expected HTTP status
    },
    
    // Deregistration delay
    deregistrationDelay: 60,                 // Wait 60s before removing
    
    // Stickiness for stateful apps
    stickiness: {
        enabled: true,
        type: "lb_cookie",
        cookieDuration: 86400,               // 24 hours
    },
});
```

---

## AWS Security Model: IAM, VPC, and Encryption

### IAM: Identity and Access Management Deep Dive

#### Understanding AWS Principal Types

```typescript
// Service principals (AWS services)
const lambdaRole = new aws.iam.Role("lambda-role", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
                Service: "lambda.amazonaws.com",      // Lambda service
            },
        }],
    }),
});

// Federated principals (external identity providers)
const githubRole = new aws.iam.Role("github-actions", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
                Federated: "arn:aws:iam::ACCOUNT:oidc-provider/token.actions.githubusercontent.com",
            },
            Condition: {
                StringEquals: {
                    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                },
                StringLike: {
                    "token.actions.githubusercontent.com:sub": "repo:myorg/myrepo:*",
                },
            },
        }],
    }),
});
```

#### IAM Policy Structure and Advanced Patterns

```typescript
// Resource-based policies with conditions
const s3BucketPolicy = new aws.iam.Policy("s3-policy", {
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                Effect: "Allow",
                Action: [
                    "s3:GetObject",
                    "s3:PutObject",
                ],
                Resource: "arn:aws:s3:::my-bucket/uploads/*",
                Condition: {
                    StringEquals: {
                        "s3:x-amz-server-side-encryption": "AES256",  // Require encryption
                    },
                    IpAddress: {
                        "aws:SourceIp": ["203.0.113.0/24"],          // IP restriction
                    },
                    DateGreaterThan: {
                        "aws:CurrentTime": "2024-01-01T00:00:00Z",   // Time-based access
                    },
                },
            },
            {
                Effect: "Deny",
                Action: "*",
                Resource: "*",
                Condition: {
                    Bool: {
                        "aws:SecureTransport": "false",              // Require HTTPS
                    },
                },
            },
        ],
    }),
});

// Cross-account access
const crossAccountRole = new aws.iam.Role("cross-account", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
                AWS: "arn:aws:iam::OTHER-ACCOUNT:root",      // Another AWS account
            },
            Condition: {
                StringEquals: {
                    "sts:ExternalId": "unique-external-id",   // External ID for security
                },
            },
        }],
    }),
});
```

#### IAM Best Practices in Code

```typescript
// Least privilege principle
const appServerPolicy = new aws.iam.Policy("app-server", {
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                Effect: "Allow",
                Action: [
                    "ssm:GetParameter",
                    "ssm:GetParameters",
                ],
                Resource: `arn:aws:ssm:*:*:parameter/${projectName}/${environment}/*`,
                // Only parameters for this app/environment
            },
            {
                Effect: "Allow",
                Action: [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                ],
                Resource: `arn:aws:logs:*:*:log-group:/aws/ec2/${projectName}/*`,
                // Only log groups for this app
            },
        ],
    }),
});

// Use AWS managed policies when appropriate
new aws.iam.RolePolicyAttachment("ssm-managed", {
    role: role.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
    // AWS maintains this policy, includes necessary permissions for Systems Manager
});
```

### Network Security Architecture

#### Security Groups as Distributed Firewall

```typescript
// Application tier security group
const appSG = new aws.ec2.SecurityGroup("app", {
    description: "Application servers",
    vpcId: vpc.id,
    
    // No ingress rules defined here - added via rules for flexibility
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
    
    tags: { Tier: "Application" },
});

// Database tier security group
const dbSG = new aws.ec2.SecurityGroup("database", {
    description: "Database servers",
    vpcId: vpc.id,
    
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
    
    tags: { Tier: "Database" },
});

// Explicit rules for security group references
new aws.ec2.SecurityGroupRule("app-to-db", {
    type: "ingress",
    fromPort: 5432,
    toPort: 5432,
    protocol: "tcp",
    sourceSecurityGroupId: appSG.id,           // Only from app tier
    securityGroupId: dbSG.id,
    description: "PostgreSQL access from app tier",
});

// Load balancer to app tier
new aws.ec2.SecurityGroupRule("alb-to-app", {
    type: "ingress",
    fromPort: 8080,
    toPort: 8080,
    protocol: "tcp",
    sourceSecurityGroupId: albSG.id,
    securityGroupId: appSG.id,
    description: "HTTP from load balancer",
});
```

#### VPC Flow Logs for Network Monitoring

```typescript
// VPC Flow Logs for security monitoring
const flowLogRole = new aws.iam.Role("flow-log-role", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
                Service: "vpc-flow-logs.amazonaws.com",
            },
        }],
    }),
});

new aws.iam.RolePolicyAttachment("flow-log-policy", {
    role: flowLogRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/VPCFlowLogsDeliveryRolePolicy",
});

const flowLog = new aws.ec2.FlowLog("vpc-flow-log", {
    iamRoleArn: flowLogRole.arn,
    logDestinationType: "cloud-watch-logs",
    logDestination: logGroup.arn,
    resourceId: vpc.id,
    resourceType: "VPC",
    trafficType: "ALL",                        // ACCEPT, REJECT, or ALL
    
    // Custom format for specific fields
    logFormat: "${srcaddr} ${dstaddr} ${srcport} ${dstport} ${protocol} ${packets} ${bytes} ${start} ${end} ${action}",
});
```

### Encryption Strategy

#### Encryption at Rest Implementation

```typescript
// RDS encryption
const database = new aws.rds.Instance("postgres", {
    storageEncrypted: true,
    kmsKeyId: "alias/aws/rds",                 // Default AWS managed key
    // Or use customer managed key:
    // kmsKeyId: customerKey.arn,
});

// EBS encryption
const volume = new aws.ebs.Volume("data", {
    encrypted: true,
    kmsKeyId: customerKey.arn,                 // Customer managed key
    size: 100,
    type: "gp3",
});

// S3 encryption
const bucket = new aws.s3.Bucket("data", {
    serverSideEncryptionConfiguration: {
        rule: {
            applyServerSideEncryptionByDefault: {
                sseAlgorithm: "aws:kms",
                kmsMasterKeyId: customerKey.arn,
            },
            bucketKeyEnabled: true,            // Reduce KMS API calls
        },
    },
});

// Customer managed KMS key
const customerKey = new aws.kms.Key("app-key", {
    description: "TinyURL application encryption key",
    keyUsage: "ENCRYPT_DECRYPT",
    keySpec: "SYMMETRIC_DEFAULT",
    
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                Sid: "Enable IAM User Permissions",
                Effect: "Allow",
                Principal: {
                    AWS: `arn:aws:iam::${currentAccount.accountId}:root`,
                },
                Action: "kms:*",
                Resource: "*",
            },
            {
                Sid: "Allow use of the key",
                Effect: "Allow",
                Principal: {
                    AWS: appRole.arn,
                },
                Action: [
                    "kms:Encrypt",
                    "kms:Decrypt",
                    "kms:ReEncrypt*",
                    "kms:GenerateDataKey*",
                    "kms:DescribeKey",
                ],
                Resource: "*",
            },
        ],
    }),
});
```

#### Encryption in Transit

```typescript
// Application Load Balancer with SSL
const httpsListener = new aws.lb.Listener("https", {
    loadBalancerArn: alb.arn,
    port: 443,
    protocol: "HTTPS",
    sslPolicy: "ELBSecurityPolicy-TLS-1-2-2017-01",    // TLS 1.2+
    certificateArn: acmCertificate.arn,
    
    defaultActions: [{
        type: "forward",
        targetGroupArn: targetGroup.arn,
    }],
});

// HTTP to HTTPS redirect
const httpListener = new aws.lb.Listener("http-redirect", {
    loadBalancerArn: alb.arn,
    port: 80,
    protocol: "HTTP",
    
    defaultActions: [{
        type: "redirect",
        redirect: {
            port: "443",
            protocol: "HTTPS",
            statusCode: "HTTP_301",
        },
    }],
});

// RDS force SSL
const dbParameterGroup = new aws.rds.ParameterGroup("postgres-ssl", {
    family: "postgres15",
    parameters: [{
        name: "rds.force_ssl",
        value: "1",
    }],
});
```

---

## Managed Services vs Self-Hosted: Decision Framework

### Service Comparison Matrix

#### Database Services Decision Tree

```typescript
// Decision factors for database hosting
interface DatabaseRequirements {
    performanceRequirements: {
        iops: number;
        throughput: string;
        latency: string;
    };
    operationalComplexity: "low" | "medium" | "high";
    customConfiguration: boolean;
    costSensitivity: "low" | "medium" | "high";
    complianceRequirements: string[];
}

function chooseDatabase(requirements: DatabaseRequirements): string {
    if (requirements.customConfiguration && requirements.operationalComplexity === "high") {
        return "self-hosted-ec2";               // Full control
    }
    
    if (requirements.costSensitivity === "high") {
        return "self-hosted-ec2";               // Lower long-term cost
    }
    
    if (requirements.operationalComplexity === "low") {
        return "rds-managed";                   // AWS handles operations
    }
    
    return "rds-managed";                       // Default recommendation
}

// RDS implementation
const managedDB = new aws.rds.Instance("postgres", {
    engine: "postgres",
    instanceClass: "db.t3.medium",
    
    // AWS manages:
    // - OS patching
    // - Database patching
    // - Backups
    // - Monitoring
    // - Failover
    // - Read replicas
    
    // Trade-offs:
    // + Lower operational overhead
    // + Built-in high availability
    // + Automated backups
    // - Higher cost
    // - Less configuration control
    // - AWS-specific features
});

// Self-hosted implementation
const selfHostedDB = new aws.ec2.Instance("postgres", {
    instanceType: "t3.medium",
    userData: postgresInstallScript,
    
    // You manage:
    // - OS patching
    // - Database installation/configuration
    // - Backups
    // - Monitoring
    // - High availability setup
    // - Performance tuning
    
    // Trade-offs:
    // + Full control
    // + Custom configurations
    // + Lower long-term cost
    // - Higher operational overhead
    // - More complex disaster recovery
    // - Need database expertise
});
```

#### Container Orchestration Options

```typescript
// Option 1: ECS with Fargate (Serverless containers)
const fargateService = new aws.ecs.Service("app", {
    cluster: cluster.arn,
    taskDefinition: taskDefinition.arn,
    launchType: "FARGATE",
    
    // Pros:
    // + No server management
    // + Automatic scaling
    // + Pay per task
    // + AWS-native networking
    
    // Cons:
    // - AWS-specific
    // - Limited customization
    // - Cold start latency
});

// Option 2: EKS (Managed Kubernetes)
const eksCluster = new aws.eks.Cluster("k8s", {
    version: "1.28",
    
    // Pros:
    // + Kubernetes ecosystem
    // + Portable workloads
    // + Extensive tooling
    // + Multi-cloud capability
    
    // Cons:
    // - Kubernetes complexity
    // - Higher learning curve
    // - More expensive
    // - Need K8s expertise
});

// Option 3: EC2 with Docker
const dockerHost = new aws.ec2.Instance("docker", {
    userData: dockerInstallScript,
    
    // Pros:
    // + Simple deployment model
    // + Full control
    // + Lower cost
    // + Easy debugging
    
    // Cons:
    // - Manual scaling
    // - No built-in service discovery
    // - Single point of failure
    // - More operational overhead
});
```

### Cost Analysis Framework

#### Reserved Instances vs On-Demand

```typescript
// Cost calculation helper
interface InstanceCostAnalysis {
    instanceType: string;
    utilizationPattern: "steady" | "variable" | "unpredictable";
    runTime: "24x7" | "business-hours" | "weekend-batch";
    commitmentTerm: "1-year" | "3-year" | "none";
}

function calculateOptimalPricing(analysis: InstanceCostAnalysis): string {
    const onDemandHourly = getOnDemandPrice(analysis.instanceType);
    const ri1YearHourly = getReservedPrice(analysis.instanceType, "1-year");
    const ri3YearHourly = getReservedPrice(analysis.instanceType, "3-year");
    
    if (analysis.utilizationPattern === "steady" && analysis.runTime === "24x7") {
        if (analysis.commitmentTerm === "3-year") {
            return "reserved-3-year";           // Lowest cost for steady workloads
        }
        return "reserved-1-year";
    }
    
    if (analysis.utilizationPattern === "variable") {
        return "spot-instances";                // Up to 90% discount
    }
    
    return "on-demand";                         // Flexibility for unpredictable workloads
}

// Spot instances implementation
const spotASG = new aws.autoscaling.Group("spot-asg", {
    launchTemplate: {
        id: spotLaunchTemplate.id,
        version: "$Latest",
    },
    
    // Mixed instance types for better availability
    mixedInstancesPolicy: {
        instancesDistribution: {
            onDemandPercentage: 20,             // 20% on-demand for stability
            spotAllocationStrategy: "diversified",
            spotInstancePools: 4,
        },
        launchTemplate: {
            launchTemplateSpecification: {
                launchTemplateId: spotLaunchTemplate.id,
                version: "$Latest",
            },
            overrides: [
                { instanceType: "t3.medium" },
                { instanceType: "t3.large" },
                { instanceType: "t3a.medium" },  // AMD instances often cheaper
                { instanceType: "t3a.large" },
            ],
        },
    },
});
```

---

## DevOps Practices: CI/CD, Monitoring, and Operations

### Infrastructure CI/CD Pipeline

#### GitOps Workflow with Pulumi

```typescript
// GitHub Actions workflow for infrastructure
// .github/workflows/infrastructure.yml
const infrastructurePipeline = `
name: Infrastructure Deployment

on:
  push:
    branches: [ main ]
    paths: [ 'infrastructure/**' ]
  pull_request:
    branches: [ main ]
    paths: [ 'infrastructure/**' ]

jobs:
  preview:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      
      - name: Install dependencies
        run: npm install
        working-directory: infrastructure
      
      - name: Pulumi Preview
        uses: pulumi/actions@v4
        with:
          command: preview
          stack-name: dev
          work-dir: infrastructure
        env:
          PULUMI_ACCESS_TOKEN: \${{ secrets.PULUMI_ACCESS_TOKEN }}
          AWS_ACCESS_KEY_ID: \${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: \${{ secrets.AWS_SECRET_ACCESS_KEY }}

  deploy:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      
      - name: Pulumi Up
        uses: pulumi/actions@v4
        with:
          command: up
          stack-name: production
          work-dir: infrastructure
`;

// Infrastructure testing
const infrastructureTests = new aws.lambda.Function("infra-test", {
    runtime: "nodejs18.x",
    handler: "index.handler",
    role: testRole.arn,
    
    code: new pulumi.asset.AssetArchive({
        "index.js": new pulumi.asset.StringAsset(`
            exports.handler = async (event) => {
                const tests = [
                    testDatabaseConnectivity,
                    testLoadBalancerHealth,
                    testAutoScalingPolicy,
                    testSecurityGroups,
                ];
                
                const results = await Promise.all(
                    tests.map(test => test().catch(err => ({ error: err.message })))
                );
                
                return {
                    statusCode: results.every(r => !r.error) ? 200 : 500,
                    body: JSON.stringify({ testResults: results }),
                };
            };
        `),
    }),
});
```

### Monitoring and Observability

#### CloudWatch Custom Metrics and Dashboards

```typescript
// Custom application metrics
const customMetrics = new aws.cloudwatch.Dashboard("app-dashboard", {
    dashboardName: "TinyURL-Application",
    dashboardBody: JSON.stringify({
        widgets: [
            {
                type: "metric",
                properties: {
                    metrics: [
                        ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", alb.arnSuffix],
                        [".", "TargetResponseTime", ".", "."],
                        [".", "HTTPCode_ELB_5XX_Count", ".", "."],
                    ],
                    period: 300,
                    stat: "Sum",
                    region: "us-east-1",
                    title: "Load Balancer Metrics",
                },
            },
            {
                type: "metric",
                properties: {
                    metrics: [
                        ["MyApp", "ShortUrlsCreated", "Environment", "production"],
                        [".", "DatabaseConnections", ".", "."],
                        [".", "CacheHitRate", ".", "."],
                    ],
                    period: 300,
                    stat: "Average",
                    region: "us-east-1",
                    title: "Application Metrics",
                },
            },
        ],
    }),
});

// Custom metric alarms
const highErrorRate = new aws.cloudwatch.MetricAlarm("high-error-rate", {
    name: "high-error-rate",
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 2,
    metricName: "HTTPCode_ELB_5XX_Count",
    namespace: "AWS/ApplicationELB",
    period: 300,
    statistic: "Sum",
    threshold: 10,
    alarmDescription: "High error rate detected",
    
    dimensions: {
        LoadBalancer: alb.arnSuffix,
    },
    
    alarmActions: [snsAlert.arn],
    okActions: [snsAlert.arn],
});
```

#### Distributed Tracing and APM

```typescript
// X-Ray tracing for microservices
const xrayRole = new aws.iam.Role("xray-role", {
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
});

new aws.iam.RolePolicyAttachment("xray-policy", {
    role: xrayRole.name,
    policyArn: "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess",
});

// Enable X-Ray in application code
const xrayConfig = `
// npm install aws-xray-sdk-core
const AWSXRay = require('aws-xray-sdk-core');
const aws = AWSXRay.captureAWS(require('aws-sdk'));

// Capture all HTTP requests
const express = require('express');
const app = express();

app.use(AWSXRay.express.openSegment('TinyURL'));

app.get('/api/shorten', async (req, res) => {
    const segment = AWSXRay.getSegment();
    const subsegment = segment.addNewSubsegment('database-query');
    
    try {
        const result = await pool.query('SELECT * FROM urls WHERE id = $1', [id]);
        subsegment.close();
        res.json(result.rows[0]);
    } catch (error) {
        subsegment.addError(error);
        subsegment.close();
        res.status(500).json({ error: error.message });
    }
});

app.use(AWSXRay.express.closeSegment());
`;
```

### Log Aggregation and Analysis

```typescript
// Centralized logging with CloudWatch Logs Insights
const logAnalysis = new aws.cloudwatch.LogGroup("app-logs", {
    name: "/aws/ec2/tinyurl",
    retentionInDays: 30,
});

// CloudWatch Logs Insights queries
const logQueries = {
    errorAnalysis: `
        fields @timestamp, @message
        | filter @message like /ERROR/
        | stats count() by bin(5m)
        | sort @timestamp desc
    `,
    
    performanceAnalysis: `
        fields @timestamp, @message
        | filter @message like /response_time/
        | parse @message "response_time=* ms"
        | stats avg(response_time), max(response_time), min(response_time) by bin(5m)
    `,
    
    userBehaviorAnalysis: `
        fields @timestamp, @message
        | filter @message like /POST \/api\/shorten/
        | parse @message "ip=* url=*"
        | stats count() by ip
        | sort count desc
        | limit 20
    `,
};

// Automated log analysis with Lambda
const logProcessor = new aws.lambda.Function("log-processor", {
    runtime: "python3.9",
    handler: "index.handler",
    role: logProcessorRole.arn,
    
    code: new pulumi.asset.AssetArchive({
        "index.py": new pulumi.asset.StringAsset(`
import json
import boto3
import gzip
import base64

def handler(event, context):
    # Decode CloudWatch Logs data
    cw_data = event['awslogs']['data']
    decoded_data = gzip.decompress(base64.b64decode(cw_data))
    log_data = json.loads(decoded_data)
    
    cloudwatch = boto3.client('cloudwatch')
    
    for log_event in log_data['logEvents']:
        message = log_event['message']
        
        # Parse application metrics from logs
        if 'response_time' in message:
            response_time = extract_response_time(message)
            cloudwatch.put_metric_data(
                Namespace='MyApp',
                MetricData=[{
                    'MetricName': 'ResponseTime',
                    'Value': response_time,
                    'Unit': 'Milliseconds',
                    'Dimensions': [
                        {'Name': 'Environment', 'Value': 'production'}
                    ]
                }]
            )
        
        # Detect anomalies
        if 'ERROR' in message and 'database' in message:
            # Send alert for database errors
            send_alert(message)
    
    return {'statusCode': 200}
        `),
    }),
});

// Subscribe Lambda to log group
const logSubscription = new aws.cloudwatch.LogSubscriptionFilter("log-subscription", {
    logGroup: logAnalysis.name,
    filterPattern: "[timestamp, request_id, level=\"ERROR\", ...]",
    destinationArn: logProcessor.arn,
});
```

This comprehensive guide provides senior engineers with the deep AWS/IaC/DevOps knowledge needed to understand and extend the TinyURL infrastructure, focusing on cloud-specific concepts and production-ready patterns.