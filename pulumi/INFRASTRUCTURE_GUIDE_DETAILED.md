# TinyURL Pulumi Infrastructure: The Complete Deep Dive Guide

This comprehensive guide provides an exhaustive explanation of every line, concept, and decision in the TinyURL infrastructure codebase. No prior AWS or infrastructure knowledge is assumed.

## Table of Contents

1. [Foundation Concepts](#foundation-concepts)
2. [The Main Orchestrator: index.ts Line-by-Line](#the-main-orchestrator-indexts-line-by-line)
3. [Component Architecture Deep Dive](#component-architecture-deep-dive)
4. [The CouchDB Component: Complete Analysis](#the-couchdb-component-complete-analysis)
5. [The PostgreSQL Component: Complete Analysis](#the-postgresql-component-complete-analysis)
6. [The Redis Component: Complete Analysis](#the-redis-component-complete-analysis)
7. [The Application Server Component: Complete Analysis](#the-application-server-component-complete-analysis)
8. [The Load Balancer Component: Complete Analysis](#the-load-balancer-component-complete-analysis)
9. [Security Architecture: Every Rule Explained](#security-architecture-every-rule-explained)
10. [Networking: The Complete Picture](#networking-the-complete-picture)
11. [Configuration Management: Every Setting](#configuration-management-every-setting)
12. [Troubleshooting: Every Possible Issue](#troubleshooting-every-possible-issue)

---

## Foundation Concepts

Before we dive into code, let's understand every fundamental concept:

### What is Cloud Computing?

Instead of buying physical servers and putting them in your office, you rent computing power from companies like Amazon (AWS), Microsoft (Azure), or Google (GCP). Think of it like:
- **Traditional**: Buying a car
- **Cloud**: Using Uber - you get transportation without owning the vehicle

### What is AWS (Amazon Web Services)?

AWS is Amazon's cloud computing platform. It offers over 200 services, but we're using just a handful:
- **EC2**: Virtual servers (like renting a computer)
- **RDS**: Managed databases (like hiring a database administrator)
- **ElastiCache**: Managed Redis (like hiring a caching expert)
- **ALB**: Load balancers (like hiring a traffic director)
- **VPC**: Virtual networks (like building your own private internet)

### What is Infrastructure as Code (IaC)?

Traditional approach: Click through web interfaces to create resources
IaC approach: Write code that creates resources

Benefits:
1. **Repeatability**: Run the same code, get the same infrastructure
2. **Version Control**: Track who changed what and when
3. **Code Review**: Team members can review infrastructure changes
4. **Documentation**: The code IS the documentation
5. **Automation**: Deploy entire environments with one command

### What is Pulumi?

Pulumi is an IaC tool that lets you use real programming languages. Competitors:
- **Terraform**: Uses its own language (HCL)
- **CloudFormation**: Uses YAML/JSON
- **Pulumi**: Uses TypeScript, Python, Go, C#, etc.

### TypeScript Basics You Need

```typescript
// Variables
const name = "value";           // Constant (can't change)
let count = 0;                  // Variable (can change)

// Types
const text: string = "hello";   // String type
const num: number = 42;         // Number type
const list: string[] = ["a"];   // Array of strings

// Functions
function add(a: number, b: number): number {
    return a + b;
}

// Objects
const config = {
    name: "tinyurl",
    port: 3000
};

// Classes
class MyClass {
    constructor(name: string) {
        this.name = name;
    }
}

// Imports/Exports
import { something } from "./file";
export const myVariable = "value";
```

---

## The Main Orchestrator: index.ts Line-by-Line

Let's dissect every single line of the main infrastructure file:

### Lines 1-9: Imports Section

```typescript
import * as pulumi from "@pulumi/pulumi";
```
**What this does**: Imports Pulumi's core library
**Why we need it**: Provides base classes and functions for defining infrastructure
**The `* as pulumi` syntax**: Imports everything from the module under the name `pulumi`

```typescript
import * as aws from "@pulumi/aws";
```
**What this does**: Imports AWS-specific resource types
**Why we need it**: To create AWS resources like EC2 instances, RDS databases, etc.
**Examples**: `aws.ec2.Instance`, `aws.rds.Instance`, `aws.elasticache.Cluster`

```typescript
import * as awsx from "@pulumi/awsx";
```
**What this does**: Imports Pulumi's high-level AWS components
**Why we need it**: Provides simplified abstractions for complex AWS patterns
**Key difference**: `aws` gives you raw AWS resources, `awsx` gives you opinionated, best-practice implementations

```typescript
import { CouchDB } from "./components/couchdb";
import { PostgreSQL } from "./components/postgresql";
import { Redis } from "./components/redis";
import { AppServer } from "./components/appserver";
import { LoadBalancer } from "./components/loadbalancer";
import { DebugLambda } from "./components/debug-lambda";
```
**What this does**: Imports our custom component classes
**Why components**: Encapsulates complex resource creation into reusable modules
**The `{ }` syntax**: Destructuring import - imports specific exports by name

### Lines 11-16: Configuration Loading

```typescript
const config = new pulumi.Config();
```
**What this does**: Creates a configuration object
**Where values come from**: Pulumi.dev.yaml, Pulumi.prod.yaml, etc.
**Why use config**: Allows different values for different environments without code changes

```typescript
const projectName = config.require("projectName");
```
**What this does**: Gets a required configuration value
**The `require` method**: Throws an error if the value is missing
**Alternative**: `config.get("projectName")` returns undefined if missing
**Type inference**: TypeScript knows this returns a string

```typescript
const environment = config.require("environment");
```
**What this does**: Gets the environment name (dev, staging, prod)
**Why we need it**: To tag resources and create environment-specific names

```typescript
const vpcCidr = config.require("vpcCidr");
```
**What this does**: Gets the IP address range for our VPC
**CIDR notation explained**: 
- `10.0.0.0/16` means IP addresses from 10.0.0.0 to 10.0.255.255
- The `/16` means the first 16 bits are fixed (10.0.x.x)
- This gives us 65,536 IP addresses to use

```typescript
const availabilityZones = config.requireObject<string[]>("availabilityZones");
```
**What this does**: Gets an array of availability zones
**The `<string[]>` syntax**: TypeScript generic - tells TypeScript this is an array of strings
**Example value**: `["eu-west-1a", "eu-west-1b"]`
**Why multiple AZs**: For high availability - if one data center fails, the other continues

### Lines 18-28: VPC Creation

```typescript
const vpc = new awsx.ec2.Vpc(`${projectName}-vpc`, {
```
**What this does**: Creates a new Virtual Private Cloud
**The template literal**: `` `${projectName}-vpc` `` becomes "tinyurl-vpc"
**First parameter**: The logical name Pulumi uses to track this resource
**Second parameter**: Configuration object

```typescript
    cidrBlock: vpcCidr,
```
**What this does**: Sets the IP address range
**Why specify**: Prevents conflicts with other VPCs or on-premise networks
**Common ranges**: 10.0.0.0/16, 172.16.0.0/16, 192.168.0.0/16

```typescript
    numberOfAvailabilityZones: availabilityZones.length,
```
**What this does**: Creates subnets in multiple availability zones
**Behind the scenes**: If you pass 2, it creates:
- 2 public subnets (one per AZ)
- 2 private subnets (one per AZ)
- 2 NAT gateways (one per AZ)

```typescript
    enableDnsHostnames: true,
    enableDnsSupport: true,
```
**What these do**: 
- `enableDnsHostnames`: Assigns DNS names to EC2 instances (ip-10-0-0-5.eu-west-1.compute.internal)
- `enableDnsSupport`: Enables DNS resolution within the VPC
**Why both**: Some AWS services require DNS to function properly

```typescript
    tags: {
        Name: `${projectName}-vpc`,
        Environment: environment,
    },
```
**What this does**: Adds metadata tags to the VPC
**Why tag resources**: 
- **Cost tracking**: See costs per environment/project
- **Organization**: Find resources in AWS console
- **Automation**: Scripts can find resources by tags

### Lines 30-44: Application Security Group

```typescript
const appSecurityGroup = new aws.ec2.SecurityGroup(`${projectName}-app-sg`, {
```
**What this does**: Creates a firewall for application servers
**Mental model**: Like a bouncer with a guest list
**The `-sg` suffix**: Common convention for security group names

```typescript
    description: "Security group for application servers",
```
**What this does**: Human-readable description
**Why important**: Helps others (and future you) understand the purpose
**Shows in**: AWS console, CLI outputs, documentation

```typescript
    vpcId: vpc.vpcId,
```
**What this does**: Associates this security group with our VPC
**The `.vpcId` property**: Pulumi automatically extracts the ID after VPC creation
**Type**: `pulumi.Output<string>` - a promise-like value that resolves after deployment

```typescript
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
```
**What this does**: Allows all outbound traffic
**Breaking it down**:
- `fromPort: 0, toPort: 0`: All ports (0 is special meaning "all")
- `protocol: "-1"`: All protocols (TCP, UDP, ICMP, etc.)
- `cidrBlocks: ["0.0.0.0/0"]`: To anywhere on the internet
**Why allow all outbound**: Apps need to:
- Download packages (npm, apt-get)
- Call external APIs
- Send metrics to monitoring services

### Lines 46-73: Load Balancer Security Group

```typescript
const albSecurityGroup = new aws.ec2.SecurityGroup(`${projectName}-alb-sg`, {
    description: "Security group for Application Load Balancer",
    vpcId: vpc.vpcId,
    ingress: [
        {
            fromPort: 80,
            toPort: 80,
            protocol: "tcp",
            cidrBlocks: ["0.0.0.0/0"],
        },
```
**What this does**: Allows HTTP traffic from anywhere
**Port 80**: Standard HTTP port
**Why from anywhere**: Load balancer needs to accept public internet traffic

```typescript
        {
            fromPort: 443,
            toPort: 443,
            protocol: "tcp",
            cidrBlocks: ["0.0.0.0/0"],
        },
```
**What this does**: Allows HTTPS traffic from anywhere
**Port 443**: Standard HTTPS port
**Currently unused**: We only set up HTTP listener, but ready for SSL/TLS

### Lines 75-88: Database Security Group

```typescript
const databaseSecurityGroup = new aws.ec2.SecurityGroup(`${projectName}-database-sg`, {
    description: "Security group for databases",
    vpcId: vpc.vpcId,
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
```
**What this does**: Creates a security group for all databases
**No ingress rules**: We'll add specific rules next
**Why separate SG**: Different databases might need different rules later

### Lines 90-98: Security Group Rules - ALB to App

```typescript
new aws.ec2.SecurityGroupRule("app-ingress-from-alb", {
    type: "ingress",
    fromPort: 3000,
    toPort: 3000,
    protocol: "tcp",
    sourceSecurityGroupId: albSecurityGroup.id,
    securityGroupId: appSecurityGroup.id,
});
```
**What this does**: Allows load balancer to reach app servers on port 3000
**Why separate rule**: More flexible than inline rules - can be modified independently
**The flow**: Internet → ALB (port 80) → App Server (port 3000)
**Security benefit**: App servers ONLY accept traffic from the load balancer

### Lines 100-107: Security Group Rules - App to PostgreSQL

```typescript
new aws.ec2.SecurityGroupRule("postgres-ingress", {
    type: "ingress",
    fromPort: 5432,
    toPort: 5432,
    protocol: "tcp",
    sourceSecurityGroupId: appSecurityGroup.id,
    securityGroupId: databaseSecurityGroup.id,
});
```
**What this does**: Allows app servers to connect to PostgreSQL
**Port 5432**: PostgreSQL's default port
**Security model**: Only app servers can reach the database
**Attack prevention**: Even if someone breaches the network, they can't directly access DB

### Lines 109-116: Security Group Rules - App to Redis

```typescript
new aws.ec2.SecurityGroupRule("redis-ingress", {
    type: "ingress",
    fromPort: 6379,
    toPort: 6379,
    protocol: "tcp",
    sourceSecurityGroupId: appSecurityGroup.id,
    securityGroupId: databaseSecurityGroup.id,
});
```
**What this does**: Allows app servers to connect to Redis
**Port 6379**: Redis's default port
**Use case**: Apps read/write cache data for fast URL lookups

### Lines 118-125: Security Group Rules - App to CouchDB

```typescript
new aws.ec2.SecurityGroupRule("couchdb-ingress", {
    type: "ingress",
    fromPort: 5984,
    toPort: 5984,
    protocol: "tcp",
    sourceSecurityGroupId: appSecurityGroup.id,
    securityGroupId: databaseSecurityGroup.id,
});
```
**What this does**: Allows app servers to connect to CouchDB
**Port 5984**: CouchDB's default HTTP API port
**Protocol**: TCP because CouchDB uses HTTP/REST API

### Lines 127-135: CouchDB Instance Creation

```typescript
const couchdb = new CouchDB("couchdb", {
    projectName,
    environment,
    vpcId: vpc.vpcId,
    subnetId: vpc.privateSubnetIds[0],
    securityGroupId: databaseSecurityGroup.id,
    instanceType: config.require("couchdbInstanceType"),
});
```
**What this does**: Creates CouchDB infrastructure
**Component pattern**: Encapsulates all CouchDB-related resources
**Parameters explained**:
- `"couchdb"`: Logical name for Pulumi
- `projectName, environment`: For naming/tagging
- `vpcId`: Which VPC to deploy in
- `subnetId`: Uses first private subnet (`[0]`)
- `securityGroupId`: Applies database security rules
- `instanceType`: From config (t3.micro, t3.small, etc.)

### Lines 137-150: PostgreSQL RDS Creation

```typescript
const postgresPassword = config.requireSecret("postgresPassword");
```
**What this does**: Gets password from encrypted config
**The `requireSecret` method**: Ensures the value is encrypted in state
**Security**: Pulumi encrypts secrets at rest and in transit

```typescript
const postgres = new PostgreSQL("postgres", {
    projectName,
    environment,
    vpcId: vpc.vpcId,
    subnetIds: vpc.privateSubnetIds as unknown as [string],
    securityGroupIds: [databaseSecurityGroup.id],
    instanceClass: config.require("postgresInstanceClass"),
    allocatedStorage: config.requireNumber("postgresStorageSize"),
    dbName: config.require("postgresDbName"),
    username: config.require("postgresUsername"),
    password: postgresPassword,
});
```
**The type casting**: `as unknown as [string]` works around TypeScript strictness
**Why array of subnets**: RDS requires multiple subnets for Multi-AZ deployments
**Parameters**:
- `instanceClass`: Size of database server (db.t3.micro = 1 vCPU, 1GB RAM)
- `allocatedStorage`: Disk size in GB
- `dbName`: Initial database name
- `username/password`: Master credentials

### Lines 152-160: Redis ElastiCache Creation

```typescript
const redis = new Redis("redis", {
    projectName,
    environment,
    vpcId: vpc.vpcId,
    subnetIds: vpc.privateSubnetIds as unknown as [string],
    securityGroupIds: [databaseSecurityGroup.id],
    nodeType: config.require("redisNodeType"),
});
```
**What this does**: Creates managed Redis cache
**ElastiCache benefits**: AWS handles backups, patches, failover
**nodeType examples**:
- `cache.t3.micro`: 1 vCPU, 0.5GB RAM
- `cache.t3.small`: 2 vCPU, 1.37GB RAM

### Lines 162-179: Application Server Creation

```typescript
const appServer = new AppServer("app-server", {
    projectName,
    environment,
    vpcId: vpc.vpcId,
    subnetIds: vpc.privateSubnetIds as unknown as [string],
    securityGroupId: appSecurityGroup.id,
    instanceType: config.require("appInstanceType"),
    desiredCapacity: config.requireNumber("appDesiredCapacity"),
    minSize: config.requireNumber("appMinSize"),
    maxSize: config.requireNumber("appMaxSize"),
    postgresEndpoint: postgres.endpoint,
    postgresUsername: config.require("postgresUsername"),
    postgresPassword: postgresPassword,
    postgresDbName: config.require("postgresDbName"),
    redisEndpoint: redis.endpoint,
    couchdbEndpoint: couchdb.endpoint,
});
```
**What this does**: Creates auto-scaling application servers
**Scaling parameters**:
- `desiredCapacity`: Normal number of servers (e.g., 2)
- `minSize`: Minimum servers even during low traffic (e.g., 1)
- `maxSize`: Maximum servers during high traffic (e.g., 10)
**Database endpoints**: Passed so apps know where to connect

### Lines 181-189: Load Balancer Creation

```typescript
const loadBalancer = new LoadBalancer("load-balancer", {
    projectName,
    environment,
    vpcId: vpc.vpcId,
    subnetIds: vpc.publicSubnetIds as unknown as [string],
    securityGroupId: albSecurityGroup.id,
    targetGroupArn: appServer.targetGroupArn,
});
```
**What this does**: Creates Application Load Balancer
**Public subnets**: Load balancer needs internet access
**targetGroupArn**: Links load balancer to app servers

### Lines 191-198: Debug Lambda Creation

```typescript
const debugLambda = new DebugLambda("debug-lambda", {
    projectName,
    environment,
    vpcId: vpc.vpcId,
    subnetIds: vpc.privateSubnetIds as unknown as [string],
    securityGroupId: appSecurityGroup.id,
});
```
**What this does**: Creates Lambda function for debugging
**Use case**: Test connectivity between components
**Same security group**: Can test same connections as app servers

### Lines 200-210: Stack Outputs

```typescript
export const loadBalancerDns = loadBalancer.dnsName;
```
**What this does**: Exports the load balancer's DNS name
**When available**: After deployment completes
**Example output**: `tinyurl-alb-588572973.eu-west-1.elb.amazonaws.com`

```typescript
export const tinyurlAppUrl = pulumi.interpolate`http://${loadBalancer.dnsName}`;
```
**What this does**: Creates the full application URL
**The `interpolate` function**: Combines Pulumi outputs into strings
**Use**: This is the URL users visit

```typescript
export const postgresEndpoint = postgres.endpoint;
export const redisEndpoint = redis.endpoint;
export const couchdbEndpoint = couchdb.endpoint;
export const couchdbPrivateIp = couchdb.privateIp;
export const couchdbInstanceId = couchdb.instanceId;
export const vpcId = vpc.vpcId;
export const appServerAsgName = appServer.asgName;
export const debugLambdaName = debugLambda.functionName;
```
**What these do**: Export various resource identifiers
**Why export**: For debugging, connecting, and referencing in other tools

---

## Component Architecture Deep Dive

### Understanding Pulumi Components

Components are like blueprints for infrastructure patterns. Instead of creating 20 individual resources for a database setup, you create one component that handles everything.

```typescript
export class MyComponent extends pulumi.ComponentResource {
    constructor(name: string, args: MyComponentArgs, opts?: pulumi.ComponentResourceOptions) {
        super("myapp:components:MyComponent", name, {}, opts);
        
        // Create child resources here
        
        this.registerOutputs({
            // Register outputs here
        });
    }
}
```

**Key concepts**:
1. **Extends ComponentResource**: Base class for custom components
2. **Constructor pattern**: Takes name, args, and optional options
3. **Super call**: Registers component with Pulumi engine
4. **Child resources**: Created with `{ parent: this }`
5. **Register outputs**: Makes properties available to parent

---

## The CouchDB Component: Complete Analysis

Let's examine every single line of the CouchDB component:

### Lines 1-3: Imports

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as random from '@pulumi/random';
```
**The random import**: For generating secure passwords
**Why @pulumi/random**: Generates values that are stored in state

### Lines 5-12: Interface Definition

```typescript
export interface CouchDBArgs {
    projectName: string;
    environment: string;
    vpcId: pulumi.Input<string>;
    subnetId: pulumi.Input<string>;
    securityGroupId: pulumi.Input<string>;
    instanceType: string;
}
```
**What this does**: Defines the "contract" for creating CouchDB
**The `pulumi.Input<T>` type**: Can accept:
- Raw values: `"subnet-123"`
- Outputs: `vpc.privateSubnetIds[0]`
- Promises: `Promise.resolve("subnet-123")`

### Lines 14-17: Class Definition

```typescript
export class CouchDB extends pulumi.ComponentResource {
    public readonly endpoint: pulumi.Output<string>;
    public readonly instanceId: pulumi.Output<string>;
    public readonly privateIp: pulumi.Output<string>;
```
**What this does**: Defines what the component exposes
**The `readonly` modifier**: These can't be changed after creation
**The `pulumi.Output<T>` type**: Resolved values after deployment

### Lines 19-21: Constructor Start

```typescript
constructor(name: string, args: CouchDBArgs, opts?: pulumi.ComponentResourceOptions) {
    super("tinyurl:components:CouchDB", name, {}, opts);
```
**The type string**: "tinyurl:components:CouchDB" - unique identifier
**Empty object `{}`**: No args to parent (component manages its own state)

### Lines 23-36: AMI Lookup

```typescript
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
```
**What this does**: Finds the latest Ubuntu 22.04 AMI
**Why not hardcode AMI ID**: IDs change per region
**The owner ID**: Canonical's official AWS account
**HVM virtualization**: Modern virtualization (vs old PV)
**Why Ubuntu**: Better Docker support than Amazon Linux

### Lines 38-45: Password Generation

```typescript
const adminPassword = new random.RandomPassword(`${name}-admin-password`, {
    length: 32,
    special: false,
    upper: true,
    lower: true,
    numeric: true,
}, { parent: this });
```
**What this does**: Generates a secure random password
**Why no special characters**: URL-encoding issues with CouchDB connections
**The parent option**: Makes this a child of our component
**State storage**: Password is encrypted and stored in Pulumi state

### Lines 47-52: SSM Parameter Store

```typescript
new aws.ssm.Parameter(`${name}-admin-password-param`, {
    name: `/${args.projectName}/${args.environment}/couchdb/admin_password`,
    type: "SecureString",
    value: adminPassword.result,
    tags: {
        Environment: args.environment,
    },
}, { parent: this });
```
**What this does**: Stores password in AWS Systems Manager
**Why SSM**: Secure, centralized password storage
**The path structure**: Organized hierarchy for multiple environments
**SecureString**: Encrypted at rest using AWS KMS

### Lines 54-115: User Data Script

This is the script that runs when the EC2 instance starts:

```bash
#!/bin/bash -x
exec > >(tee /var/log/user-data.log)
exec 2>&1
```
**What this does**: 
- `#!/bin/bash -x`: Run bash with debug output
- `exec > >(tee ...)`: Redirect output to both console and log file
- `exec 2>&1`: Redirect errors to same place as output

```bash
echo "Starting CouchDB installation at $(date)"

# Update system
echo "Updating system packages..."
apt-get update -y
```
**What this does**: Updates package lists
**The -y flag**: Automatic yes to prompts

```bash
# Install Docker
echo "Installing Docker..."
apt-get install -y docker.io
systemctl start docker
systemctl enable docker
```
**What this does**: 
- Installs Docker from Ubuntu repos
- Starts Docker service immediately
- Enables Docker to start on boot

```bash
# Pull and run CouchDB container
echo "Running CouchDB in Docker..."
COUCHDB_PASS='${adminPassword.result}'
docker run -d \
  --name couchdb \
  --restart always \
  -p 5984:5984 \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD="$COUCHDB_PASS" \
  -v /opt/couchdb/data:/opt/couchdb/data \
  apache/couchdb:3.3
```
**What this does**:
- `COUCHDB_PASS=`: Stores password in variable
- `-d`: Run in background (daemon)
- `--name couchdb`: Container name for management
- `--restart always`: Restart if it crashes or server reboots
- `-p 5984:5984`: Map container port to host port
- `-e`: Set environment variables
- `-v`: Mount volume for persistent data

```bash
# Wait for CouchDB to start
echo "Waiting for CouchDB to start..."
for i in {1..30}; do
    if curl -s http://localhost:5984/ > /dev/null; then
        echo "CouchDB is responding!"
        break
    fi
    echo "Waiting for CouchDB... attempt $i"
    sleep 2
done
```
**What this does**: Polls CouchDB every 2 seconds for 60 seconds
**Why wait**: Container needs time to initialize

```bash
# Configure CouchDB
echo "Configuring CouchDB..."
sleep 10

# Set up single node (using basic auth with proper escaping)
echo "Setting up CouchDB as single node..."
curl -X PUT "http://localhost:5984/_node/_local/_config/couchdb/single_node" \
  -u "admin:$COUCHDB_PASS" \
  -H "Content-Type: application/json" \
  -d '"true"'
```
**What this does**: Configures CouchDB for single-node operation
**Why single node**: Simpler than cluster setup for this use case
**The -u flag**: HTTP Basic Authentication

```bash
# Initialize system databases
echo "Initializing CouchDB system databases..."
curl -X PUT "http://localhost:5984/_users" -u "admin:$COUCHDB_PASS"
curl -X PUT "http://localhost:5984/_replicator" -u "admin:$COUCHDB_PASS"
curl -X PUT "http://localhost:5984/_global_changes" -u "admin:$COUCHDB_PASS"
```
**What this does**: Creates CouchDB system databases
**_users**: Stores user accounts
**_replicator**: Manages replication tasks
**_global_changes**: Tracks changes across databases

### Lines 117-140: IAM Role Creation

```typescript
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
```
**What this does**: Creates IAM role for EC2 instance
**Why needed**: Allows instance to access AWS services
**The assume role policy**: Says "EC2 service can use this role"

```typescript
new aws.iam.RolePolicyAttachment(`${name}-ssm-policy`, {
    role: role.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
}, { parent: this });
```
**What this does**: Attaches AWS managed policy for Systems Manager
**Why SSM**: Enables Session Manager for debugging

### Lines 137-140: Instance Profile

```typescript
const instanceProfile = new aws.iam.InstanceProfile(`${name}-profile`, {
    role: role.name,
}, { parent: this });
```
**What this does**: Wraps IAM role for EC2 use
**Why needed**: EC2 instances use profiles, not roles directly

### Lines 142-159: EC2 Instance Creation

```typescript
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
```
**Breaking down each property**:
- `ami`: The Ubuntu image we looked up
- `instanceType`: Server size (t3.micro = 1 vCPU, 1GB RAM)
- `subnetId`: Which network subnet to launch in
- `vpcSecurityGroupIds`: Firewall rules to apply
- `iamInstanceProfile`: For AWS service access
- `userData`: Startup script we defined
- `rootBlockDevice`: 30GB encrypted SSD
- `tags`: For identification and billing

### Lines 161-169: Output Registration

```typescript
this.instanceId = instance.id;
this.privateIp = instance.privateIp;
this.endpoint = pulumi.interpolate`http://${instance.privateIp}:5984`;

this.registerOutputs({
    endpoint: this.endpoint,
    instanceId: this.instanceId,
    privateIp: this.privateIp,
});
```
**What this does**: Makes instance details available to parent
**The endpoint**: Constructs CouchDB URL for apps to use

---

## The PostgreSQL Component: Complete Analysis

### Lines 1-15: Setup and Interface

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface PostgreSQLArgs {
    projectName: string;
    environment: string;
    vpcId: pulumi.Input<string>;
    subnetIds: pulumi.Input<string>[];
    securityGroupIds: pulumi.Input<string>[];
    instanceClass: string;
    allocatedStorage: number;
    dbName: string;
    username: string;
    password: pulumi.Input<string>;
}
```
**Key differences from CouchDB**:
- `subnetIds` is array: RDS needs multiple subnets
- `password` is Input: Can accept encrypted values
- `allocatedStorage`: Disk size in GB

### Lines 17-24: Class Definition

```typescript
export class PostgreSQL extends pulumi.ComponentResource {
    public readonly endpoint: pulumi.Output<string>;
    public readonly address: pulumi.Output<string>;
    public readonly port: pulumi.Output<number>;
    public readonly databaseName: pulumi.Output<string>;
```
**What we expose**:
- `endpoint`: Full connection string with port
- `address`: Just the hostname
- `port`: Database port (usually 5432)
- `databaseName`: Name of created database

### Lines 26-34: Subnet Group Creation

```typescript
const subnetGroup = new aws.rds.SubnetGroup(`${name}-subnet-group`, {
    name: `${args.projectName}-postgres-subnet-group`,
    subnetIds: args.subnetIds,
    tags: {
        Name: `${args.projectName}-postgres-subnet-group`,
        Environment: args.environment,
    },
}, { parent: this });
```
**What this does**: Groups subnets for RDS
**Why needed**: RDS requires subnets in multiple AZs
**Multi-AZ benefit**: Automatic failover if one AZ fails

### Lines 36-60: RDS Instance Creation

```typescript
const dbInstance = new aws.rds.Instance(`${name}-instance`, {
    identifier: `${args.projectName}-postgres`,
    engine: "postgres",
    engineVersion: "17.5",
```
**What this does**: Creates PostgreSQL database
**Version 17.5**: Latest stable PostgreSQL version
**Managed service**: AWS handles backups, patches, failover

```typescript
    instanceClass: args.instanceClass,
    allocatedStorage: args.allocatedStorage,
    storageType: "gp3",
    storageEncrypted: true,
```
**Storage configuration**:
- `instanceClass`: db.t3.micro = 1 vCPU, 1GB RAM
- `allocatedStorage`: Initial disk size
- `gp3`: Latest SSD type with better price/performance
- `storageEncrypted`: Encryption at rest

```typescript
    dbName: args.dbName,
    username: args.username,
    password: args.password,
    vpcSecurityGroupIds: args.securityGroupIds,
    dbSubnetGroupName: subnetGroup.name,
```
**Database configuration**:
- Creates initial database with specified name
- Master username/password for admin access
- Security groups control network access
- Subnet group for network placement

```typescript
    backupRetentionPeriod: 7,
    backupWindow: "03:00-04:00",
    maintenanceWindow: "sun:04:00-sun:05:00",
```
**Maintenance settings**:
- Keep backups for 7 days
- Backup at 3-4 AM (low traffic time)
- Maintenance Sunday 4-5 AM

```typescript
    skipFinalSnapshot: true,
    deletionProtection: false,
    enabledCloudwatchLogsExports: ["postgresql"],
```
**Operational settings**:
- `skipFinalSnapshot`: Don't create snapshot on deletion (dev setting)
- `deletionProtection`: Allow deletion (dev setting)
- CloudWatch logs: Export PostgreSQL logs for debugging

---

## The Redis Component: Complete Analysis

### Lines 1-18: Setup

```typescript
export interface RedisArgs {
    projectName: string;
    environment: string;
    vpcId: pulumi.Input<string>;
    subnetIds: pulumi.Input<string>[];
    securityGroupIds: pulumi.Input<string>[];
    nodeType: string;
}
```
**Simpler than RDS**: No username/password, database names

### Lines 21-29: Subnet Group

```typescript
const subnetGroup = new aws.elasticache.SubnetGroup(`${name}-subnet-group`, {
    name: `${args.projectName}-redis-subnet-group`,
    subnetIds: args.subnetIds,
    tags: {
        Name: `${args.projectName}-redis-subnet-group`,
        Environment: args.environment,
    },
}, { parent: this });
```
**Same pattern as RDS**: Groups subnets for placement

### Lines 31-48: ElastiCache Cluster

```typescript
const cluster = new aws.elasticache.Cluster(`${name}-cluster`, {
    clusterId: `${args.projectName}-redis`,
    engine: "redis",
    nodeType: args.nodeType,
    numCacheNodes: 1,
```
**Basic configuration**:
- Single node for simplicity
- `nodeType`: cache.t3.micro = 0.5GB RAM

```typescript
    parameterGroupName: "default.redis7",
    engineVersion: "7.0",
    port: 6379,
```
**Redis configuration**:
- Default Redis 7 parameters
- Standard Redis port

```typescript
    subnetGroupName: subnetGroup.name,
    securityGroupIds: args.securityGroupIds,
    snapshotRetentionLimit: 5,
    snapshotWindow: "03:00-05:00",
```
**Operational settings**:
- Place in our subnet group
- Apply security groups
- Keep 5 days of backups
- Backup during low traffic

### Lines 50-52: Endpoint Extraction

```typescript
this.endpoint = cluster.cacheNodes.apply(nodes => nodes[0].address);
```
**What this does**: Extracts endpoint from first node
**The `.apply()` method**: Transforms Pulumi Output values
**Why `nodes[0]`**: We only have one node

---

## The Application Server Component: Complete Analysis

This is the most complex component - let's break it down section by section:

### Lines 1-20: Interface Definition

```typescript
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
```
**What makes this complex**:
- Scaling parameters (min, max, desired)
- All database connection info
- Multiple subnets for high availability

### Lines 31-45: AMI Lookup

```typescript
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
```
**Amazon Linux 2**: Optimized for AWS, good Node.js support
**Why not Ubuntu**: AL2 has better AWS integration

### Lines 47-501: User Data Script Generation

This is where the magic happens - the script that turns a blank server into a running application:

```typescript
const userData = pulumi.all([
    args.postgresEndpoint,
    args.redisEndpoint,
    args.couchdbEndpoint,
    args.postgresPassword
]).apply(([pgEndpoint, redisEndpoint, couchdbEndpoint, pgPassword]) => {
```
**What this does**: Waits for all values to resolve
**The pulumi.all pattern**: Like Promise.all for Pulumi Outputs

#### Parsing Database Endpoints

```typescript
// Parse PostgreSQL endpoint to extract host and port
const pgParts = pgEndpoint.split(':');
const pgHost = pgParts[0];
const pgPort = pgParts[1] || '5432';

// Parse Redis endpoint to extract host
const redisHost = redisEndpoint.split(':')[0];

// Parse CouchDB endpoint to extract host
const couchdbHost = couchdbEndpoint.replace('http://', '').split(':')[0];
```
**Why parse**: Endpoints come as "host:port" but apps need them separate

#### Node.js Installation Section

```bash
# Install Node.js 16 using direct binary download
echo "Installing Node.js..."
NODE_VERSION="v16.20.2"
NODE_DISTRO="linux-x64"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_DISTRO}.tar.xz"

# Download and extract Node.js
cd /tmp
curl -fsSL ${NODE_URL} -o node.tar.xz
tar -xJf node.tar.xz
rm node.tar.xz

# Move to /usr/local
mv node-${NODE_VERSION}-${NODE_DISTRO} /usr/local/node

# Create symlinks
ln -sf /usr/local/node/bin/node /usr/bin/node
ln -sf /usr/local/node/bin/npm /usr/bin/npm
ln -sf /usr/local/node/bin/npx /usr/bin/npx
```
**Why this approach**: 
- Amazon Linux 2 has old glibc (2.26)
- Node.js 18+ needs glibc 2.28+
- Binary installation bypasses package manager

#### Getting CouchDB Password from SSM

```bash
# Get region
REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
echo "Region: $REGION"

# Get CouchDB admin password from SSM
echo "Getting CouchDB password from SSM..."
COUCHDB_PASSWORD=$(aws ssm get-parameter --name "/${args.projectName}/${args.environment}/couchdb/admin_password" --with-decryption --query 'Parameter.Value' --output text --region $REGION 2>&1)
```
**What this does**:
- Gets AWS region from instance metadata
- Retrieves encrypted password from SSM
- The 169.254.169.254 IP: AWS metadata service

#### Creating the Application

The script creates the entire Node.js application inline:

```javascript
// Create package.json
cat > package.json <<'PACKAGEJSON'
{
  "name": "tinyurl-api",
  "version": "1.0.0",
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
```
**Dependencies explained**:
- `express`: Web framework
- `pg`: PostgreSQL client
- `redis`: Redis client
- `nano`: CouchDB client
- `nanoid`: Generate short codes
- `helmet`: Security headers
- `cors`: Cross-origin requests
- `dotenv`: Environment variables

#### The Application Code

The script creates a complete Node.js application:

```javascript
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
```
**Connection pooling**: Reuses database connections
**SSL setting**: Required for AWS RDS

```javascript
// Initialize connections
async function initializeConnections() {
  try {
    // Connect to Redis
    await redisClient.connect();
    console.log('Connected to Redis');

    // Test PostgreSQL connection
    await pgPool.query('SELECT NOW()');
    console.log('Connected to PostgreSQL');

    // Create tables if needed
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS short_codes (
        short_code VARCHAR(10) UNIQUE NOT NULL PRIMARY KEY,
        used BOOLEAN DEFAULT FALSE
      )
    `);
```
**Initialization pattern**: Connect to all databases on startup
**Table creation**: Ensures required tables exist

```javascript
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
```
**Health check pattern**: Tests each service
**Status codes**: 200 if healthy, 503 if any service down

#### Creating Environment Configuration

```bash
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
COUCHDB_PASSWORD=$COUCHDB_PASSWORD
ENVEOF
```
**Environment file**: Stores all configuration
**Variable substitution**: Fills in actual values

#### Systemd Service Creation

```bash
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
```
**Systemd benefits**:
- Automatic startup on boot
- Restart on crash
- Log management
- Process supervision

### Lines 503-522: Target Group Creation

```typescript
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
```
**Health check configuration**:
- Check every 30 seconds
- 2 successful = healthy
- 2 failed = unhealthy
- 5 second timeout

### Lines 524-540: IAM Role for EC2

```typescript
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
```
**Same pattern as CouchDB**: Allows EC2 to assume role

### Lines 542-576: IAM Policy for SSM and CloudWatch

```typescript
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
```
**What this allows**: Read passwords from SSM
**Resource restriction**: Only this app's parameters

### Lines 599-624: Launch Template

```typescript
const launchTemplate = new aws.ec2.LaunchTemplate(`${name}-lt`, {
    namePrefix: `${args.projectName}-app-`,
    imageId: ami.then(a => a.id),
    instanceType: args.instanceType,
    vpcSecurityGroupIds: [args.securityGroupId],
    iamInstanceProfile: {
        arn: instanceProfile.arn,
    },
    userData: userData.apply(u => Buffer.from(u).toString('base64')),
```
**Launch template**: Blueprint for creating instances
**Base64 encoding**: Required for user data
**Name prefix**: Allows versioning

### Lines 626-652: Auto Scaling Group

```typescript
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
```
**Key settings**:
- `healthCheckType: "ELB"`: Use load balancer health checks
- `healthCheckGracePeriod: 300`: 5 minutes for startup
- `version: "$Latest"`: Always use latest launch template

### Lines 654-669: Scaling Policies

```typescript
const scaleUpPolicy = new aws.autoscaling.Policy(`${name}-scale-up`, {
    name: `${args.projectName}-scale-up`,
    scalingAdjustment: 1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 300,
    autoscalingGroupName: asg.name,
}, { parent: this });
```
**What this does**: Adds 1 instance when triggered
**Cooldown**: Wait 5 minutes before scaling again

### Lines 671-702: CloudWatch Alarms

```typescript
new aws.cloudwatch.MetricAlarm(`${name}-cpu-high`, {
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
```
**Scaling trigger**: 
- CPU > 80% for 2 periods (10 minutes)
- Adds an instance
- Similar alarm for scale down at 20%

---

## The Load Balancer Component: Complete Analysis

### Lines 22-35: ALB Creation

```typescript
const alb = new aws.lb.LoadBalancer(`${name}-alb`, {
    name: `${args.projectName}-alb`,
    internal: false,
    loadBalancerType: "application",
    securityGroups: [args.securityGroupId],
    subnets: args.subnetIds,
    enableDeletionProtection: false,
    enableHttp2: true,
```
**Key settings**:
- `internal: false`: Internet-facing
- `loadBalancerType: "application"`: Layer 7 (HTTP aware)
- `enableHttp2`: Better performance for modern browsers

### Lines 37-46: HTTP Listener

```typescript
const httpListener = new aws.lb.Listener(`${name}-http-listener`, {
    loadBalancerArn: alb.arn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [{
        type: "forward",
        targetGroupArn: args.targetGroupArn,
    }],
}, { parent: this });
```
**What this does**: Routes all HTTP traffic to app servers
**Port 80**: Standard HTTP port
**Default action**: Forward to target group

---

## Security Architecture: Every Rule Explained

### Defense in Depth

Our security model has multiple layers:

1. **Network Isolation**: VPC keeps resources private
2. **Subnet Segmentation**: Public/private subnet separation
3. **Security Groups**: Port-level access control
4. **IAM Roles**: Service-level permissions
5. **Encryption**: Data encrypted at rest and in transit

### Security Group Rules Matrix

```
┌─────────────┬───────────┬──────────┬──────────────┬─────────────┐
│   Source    │   Target  │   Port   │   Protocol   │   Purpose   │
├─────────────┼───────────┼──────────┼──────────────┼─────────────┤
│  Internet   │    ALB    │    80    │     HTTP     │  Web Access │
│  Internet   │    ALB    │   443    │    HTTPS     │  SSL Access │
│    ALB      │    App    │   3000   │     HTTP     │ App Traffic │
│    App      │ PostgreSQL│   5432   │     TCP      │  Database   │
│    App      │   Redis   │   6379   │     TCP      │    Cache    │
│    App      │  CouchDB  │   5984   │     HTTP     │  Document   │
└─────────────┴───────────┴──────────┴──────────────┴─────────────┘
```

### IAM Permissions Matrix

```
┌─────────────┬────────────────────┬──────────────────────────┐
│    Role     │      Service       │       Permissions        │
├─────────────┼────────────────────┼──────────────────────────┤
│   App-Role  │   SSM Parameter    │  Read CouchDB Password   │
│             │   CloudWatch Logs  │    Write App Logs        │
│             │   EC2 Metadata     │   Read Instance Info     │
│             │ Session Manager    │  Remote Shell Access     │
├─────────────┼────────────────────┼──────────────────────────┤
│CouchDB-Role │ Session Manager    │  Remote Shell Access     │
│             │   EC2 Metadata     │   Read Instance Info     │
└─────────────┴────────────────────┴──────────────────────────┘
```

---

## Networking: The Complete Picture

### VPC CIDR Allocation

```
VPC: 10.0.0.0/16 (65,536 IPs)
├── Public Subnets (Internet Access)
│   ├── 10.0.0.0/24 (256 IPs) - AZ 1
│   └── 10.0.1.0/24 (256 IPs) - AZ 2
└── Private Subnets (No Direct Internet)
    ├── 10.0.128.0/24 (256 IPs) - AZ 1
    └── 10.0.129.0/24 (256 IPs) - AZ 2
```

### Traffic Flow Patterns

#### Inbound Web Request
```
Internet → Internet Gateway → ALB (Public Subnet) → 
App Server (Private Subnet) → Databases (Private Subnet)
```

#### Outbound App Request
```
App Server → NAT Gateway (Public Subnet) → 
Internet Gateway → Internet
```

### Route Tables

#### Public Subnet Routes
```
Destination     Target           Purpose
0.0.0.0/0      Internet Gateway  Internet access
10.0.0.0/16    Local            VPC internal traffic
```

#### Private Subnet Routes
```
Destination     Target           Purpose
0.0.0.0/0      NAT Gateway      Outbound internet only
10.0.0.0/16    Local            VPC internal traffic
```

---

## Configuration Management: Every Setting

### Environment Variables Reference

```yaml
# Pulumi.dev.yaml
config:
  # Project Identification
  tinyurl:projectName: "tinyurl"        # Used in all resource names
  tinyurl:environment: "dev"            # dev, staging, prod
  
  # Network Configuration
  tinyurl:vpcCidr: "10.0.0.0/16"       # IP range for entire VPC
  tinyurl:availabilityZones:            # Which data centers to use
    - "eu-west-1a"
    - "eu-west-1b"
  
  # Application Server Configuration
  tinyurl:appInstanceType: "t3.micro"   # 1 vCPU, 1 GB RAM
  tinyurl:appDesiredCapacity: 2         # Normal number of servers
  tinyurl:appMinSize: 1                 # Minimum during low traffic
  tinyurl:appMaxSize: 10                # Maximum during high traffic
  
  # PostgreSQL Configuration
  tinyurl:postgresInstanceClass: "db.t3.micro"  # 1 vCPU, 1 GB RAM
  tinyurl:postgresStorageSize: 20               # GB of SSD storage
  tinyurl:postgresDbName: "tinyurl"             # Database name
  tinyurl:postgresUsername: "dbadmin"           # Master username
  
  # Redis Configuration
  tinyurl:redisNodeType: "cache.t3.micro"       # 0.5 GB RAM
  
  # CouchDB Configuration
  tinyurl:couchdbInstanceType: "t3.micro"       # 1 vCPU, 1 GB RAM
  
  # Secrets (encrypted)
  tinyurl:postgresPassword:
    secure: AAABACNlY3JldABB...  # Encrypted password
```

### Instance Type Reference

#### EC2 Instance Types
```
Type        vCPUs   Memory   Network    Use Case
t3.micro    2       1 GB     Up to 5    Dev/Test
t3.small    2       2 GB     Up to 5    Light Production
t3.medium   2       4 GB     Up to 5    Standard Production
t3.large    2       8 GB     Up to 5    Heavy Production
```

#### RDS Instance Types
```
Type           vCPUs   Memory   Network    Storage
db.t3.micro    2       1 GB     Up to 5    Up to 3,500 IOPS
db.t3.small    2       2 GB     Up to 5    Up to 3,500 IOPS
db.t3.medium   2       4 GB     Up to 5    Up to 3,500 IOPS
```

#### ElastiCache Node Types
```
Type              Memory    Network    Use Case
cache.t3.micro    0.5 GB    Up to 5    Dev/Test
cache.t3.small    1.4 GB    Up to 5    Light Cache
cache.t3.medium   3.1 GB    Up to 5    Standard Cache
```

---

## Troubleshooting: Every Possible Issue

### Component-Specific Issues

#### CouchDB Not Starting

**Symptoms**: Health check fails, can't connect to CouchDB

**Check 1: Instance Status**
```bash
aws ec2 describe-instances --instance-ids i-xxxxx \
  --query 'Reservations[0].Instances[0].State'
```

**Check 2: User Data Logs**
```bash
aws ssm send-command --instance-ids i-xxxxx \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["tail -50 /var/log/user-data.log"]'
```

**Check 3: Docker Status**
```bash
aws ssm send-command --instance-ids i-xxxxx \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["docker ps -a"]'
```

**Common Causes**:
1. Password has special characters breaking URL
2. Docker not installed properly
3. Port 5984 blocked by security group
4. Instance in wrong subnet

#### App Server Not Healthy

**Symptoms**: ALB health check failing, 502 errors

**Check 1: Target Health**
```bash
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:...
```

**Check 2: Application Logs**
```bash
aws ssm send-command --instance-ids i-xxxxx \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["journalctl -u nodeapp -n 50"]'
```

**Check 3: Node.js Status**
```bash
aws ssm send-command --instance-ids i-xxxxx \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["systemctl status nodeapp"]'
```

**Common Causes**:
1. Database connection strings wrong
2. Node.js not installed properly
3. Security group blocking database access
4. Environment variables not set

#### Database Connection Failures

**PostgreSQL Connection Error**
```
Error: connect ETIMEDOUT 10.0.x.x:5432
```
**Solution**: Check security group allows port 5432

**Redis Connection Error**
```
Error: Redis connection to 10.0.x.x:6379 failed
```
**Solution**: Check ElastiCache cluster status

**CouchDB Authentication Error**
```
Error: Name or password is incorrect
```
**Solution**: Verify password in SSM matches container

### Deployment Issues

#### Pulumi Update Failures

**Error**: "Resource already exists"
**Solution**: 
```bash
pulumi refresh --yes
pulumi up --yes
```

**Error**: "Invalid instance type"
**Solution**: Check instance type is available in region

**Error**: "Subnet not found"
**Solution**: Ensure VPC deployed successfully first

### Performance Issues

#### High CPU on App Servers
- Check CloudWatch metrics
- Verify auto-scaling policies
- Review application logs for errors

#### Slow Database Queries
- Enable RDS Performance Insights
- Check slow query log
- Verify indexes exist

#### Cache Misses
- Monitor ElastiCache metrics
- Check cache eviction policy
- Verify TTL settings

### Security Issues

#### Can't Access Via Session Manager
**Solution**: Ensure IAM role has SSMManagedInstanceCore policy

#### Permission Denied Errors
**Solution**: Check IAM role has required permissions

#### SSL/TLS Certificate Errors
**Solution**: RDS requires SSL - ensure `rejectUnauthorized: false`

---

## Best Practices Summary

### Development Environment
1. Use smallest instance types (cost optimization)
2. Set `deletionProtection: false` on databases
3. Use short backup retention periods
4. Enable detailed monitoring for debugging

### Production Environment
1. Use larger instance types with redundancy
2. Enable deletion protection on databases
3. Implement proper backup strategy (30+ days)
4. Use HTTPS with valid certificates
5. Enable AWS Shield for DDoS protection
6. Implement AWS WAF for application firewall
7. Use secrets manager for rotating credentials
8. Enable VPC Flow Logs for security analysis

### Monitoring and Alerting
1. CloudWatch dashboards for each component
2. SNS topics for critical alerts
3. Application performance monitoring (APM)
4. Log aggregation with CloudWatch Insights
5. Cost alerts and budgets

### Disaster Recovery
1. Multi-region deployment for critical apps
2. Automated backups with cross-region copies
3. Runbook documentation for incidents
4. Regular disaster recovery drills
5. RTO/RPO objectives defined

---

This detailed guide covers every line of code, every configuration option, and every architectural decision in the TinyURL infrastructure. It serves as both documentation and a learning resource for anyone working with cloud infrastructure.