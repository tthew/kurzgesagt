# TinyURL Pulumi Infrastructure Guide

This guide explains the complete AWS infrastructure setup for the TinyURL application using Pulumi (Infrastructure as Code). We'll break down every component from basic networking concepts to complex application deployment.

## Table of Contents

1. [Overview & Architecture](#overview--architecture)
2. [Prerequisites & Concepts](#prerequisites--concepts)
3. [Global Infrastructure Setup](#global-infrastructure-setup)
4. [Component Deep Dive](#component-deep-dive)
5. [Security & Networking](#security--networking)
6. [Deployment & Operations](#deployment--operations)

---

## Overview & Architecture

### What We're Building

The TinyURL application is a URL shortening service (like bit.ly) that runs on AWS cloud infrastructure. When someone enters a long URL, our service creates a short code and stores the mapping. When someone visits the short URL, they get redirected to the original long URL.

### High-Level Architecture

```
Internet
    ↓
[Load Balancer] ← Public Subnets
    ↓
[App Servers] ← Private Subnets
    ↓
[Databases] ← Private Subnets
```

### Technology Stack

- **Frontend**: Load Balancer (AWS ALB) - distributes traffic
- **Backend**: Node.js application servers (AWS EC2) - handles requests
- **Databases**: 
  - PostgreSQL (AWS RDS) - stores short codes
  - Redis (AWS ElastiCache) - caches popular URLs
  - CouchDB (EC2) - stores URL metadata
- **Infrastructure**: Pulumi (TypeScript) - defines everything as code

---

## Prerequisites & Concepts

### What is Infrastructure as Code (IaC)?

Instead of clicking through the AWS console to create resources manually, we write code that defines our infrastructure. Benefits:
- **Reproducible**: Same setup every time
- **Version controlled**: Track changes like regular code
- **Documented**: Code serves as documentation
- **Automated**: Deploy with a single command

### What is Pulumi?

Pulumi is an IaC tool that lets you use real programming languages (like TypeScript) instead of configuration files (like Terraform's HCL or AWS CloudFormation's YAML).

### Key AWS Concepts You Need to Know

#### Virtual Private Cloud (VPC)
Think of a VPC as your own private section of AWS cloud - like having your own building in a shared office complex.

#### Subnets
Subnets are like floors in your building:
- **Public Subnets**: Have direct internet access (like a lobby)
- **Private Subnets**: No direct internet access (like secure office floors)

#### Security Groups
Like building security - they control who can talk to whom on which ports.

#### Availability Zones (AZ)
Different physical data centers in the same region. We spread our infrastructure across multiple AZs for redundancy.

---

## Global Infrastructure Setup

Let's walk through the main configuration file: `index.ts`

### 1. Configuration and Imports

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
```

**What this does**: Imports the libraries we need
- `pulumi`: Core Pulumi functionality
- `aws`: AWS-specific resources
- `awsx`: Higher-level AWS components that combine multiple resources

```typescript
const config = new pulumi.Config();
const projectName = config.require("projectName");
const environment = config.require("environment");
```

**What this does**: Reads configuration from `Pulumi.dev.yaml` file. This allows us to have different settings for dev, staging, and production environments without changing code.

### 2. Virtual Private Cloud (VPC) Setup

```typescript
const vpc = new awsx.ec2.Vpc(`${projectName}-vpc`, {
    cidrBlock: vpcCidr,                          // IP address range
    numberOfAvailabilityZones: availabilityZones.length,  // Spread across AZs
    enableDnsHostnames: true,                    // Allow DNS names
    enableDnsSupport: true,                      // Enable DNS resolution
});
```

**What this creates**:
- A private network in AWS (like your own internet)
- Public subnets (with internet access) for load balancers
- Private subnets (no direct internet) for applications and databases
- Internet Gateway for public internet access
- NAT Gateways for private subnets to reach internet (outbound only)
- Route tables to direct traffic

**CIDR Block Explained**: `10.0.0.0/16` means:
- IP addresses from 10.0.0.0 to 10.0.255.255 (65,536 addresses)
- Public subnets get: 10.0.0.0/24, 10.0.1.0/24 (256 addresses each)
- Private subnets get: 10.0.128.0/24, 10.0.129.0/24 (256 addresses each)

### 3. Security Groups (Firewalls)

Security groups are like bouncers at a club - they decide who gets in and where they can go.

#### Application Load Balancer Security Group
```typescript
const albSecurityGroup = new aws.ec2.SecurityGroup(`${projectName}-alb-sg`, {
    ingress: [
        { fromPort: 80, toPort: 80, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"] },
        { fromPort: 443, toPort: 443, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"] }
    ],
});
```
**Translation**: "Allow anyone from the internet to connect on ports 80 (HTTP) and 443 (HTTPS)"

#### Application Security Group
```typescript
const appSecurityGroup = new aws.ec2.SecurityGroup(`${projectName}-app-sg`, {
    egress: [{ fromPort: 0, toPort: 0, protocol: "-1", cidrBlocks: ["0.0.0.0/0"] }],
});
```
**Translation**: "Allow outbound connections to anywhere" (apps need to call external APIs, download packages, etc.)

#### Database Security Group
```typescript
const databaseSecurityGroup = new aws.ec2.SecurityGroup(`${projectName}-database-sg`, {
    egress: [{ fromPort: 0, toPort: 0, protocol: "-1", cidrBlocks: ["0.0.0.0/0"] }],
});
```
**Translation**: "Allow outbound connections" (databases might need to download updates)

### 4. Security Group Rules (Specific Permissions)

These rules create the specific connections between components:

```typescript
// Load balancer can talk to app servers on port 3000
new aws.ec2.SecurityGroupRule("app-ingress-from-alb", {
    type: "ingress",
    fromPort: 3000, toPort: 3000, protocol: "tcp",
    sourceSecurityGroupId: albSecurityGroup.id,
    securityGroupId: appSecurityGroup.id,
});

// App servers can talk to PostgreSQL on port 5432
new aws.ec2.SecurityGroupRule("postgres-ingress", {
    type: "ingress",
    fromPort: 5432, toPort: 5432, protocol: "tcp",
    sourceSecurityGroupId: appSecurityGroup.id,
    securityGroupId: databaseSecurityGroup.id,
});
```

**What this creates**: A secure communication chain:
Internet → Load Balancer → App Servers → Databases

---

## Component Deep Dive

Now let's examine each component in detail:

### 1. CouchDB Component (`components/couchdb.ts`)

**Purpose**: Stores URL metadata and documents in a NoSQL database.

#### Why CouchDB?
- **Document storage**: Perfect for storing URL data with metadata (creation time, IP address, etc.)
- **HTTP API**: Easy to integrate with our Node.js application
- **Replication**: Can sync data between multiple instances

#### Key Parts:

**Password Generation**:
```typescript
const adminPassword = new random.RandomPassword(`${name}-admin-password`, {
    length: 32,
    special: false,  // URL-safe characters only
    upper: true, lower: true, numeric: true,
});
```
**Why URL-safe**: When the app creates connection URLs like `http://admin:password@couchdb:5984`, special characters in passwords can break URL parsing.

**EC2 Instance with Docker**:
```typescript
const instance = new aws.ec2.Instance(`${name}-instance`, {
    ami: ami.then(a => a.id),                    // Ubuntu image
    instanceType: args.instanceType,             // Server size (t3.micro, t3.small, etc.)
    subnetId: args.subnetId,                     // Private subnet
    vpcSecurityGroupIds: [args.securityGroupId], // Database security group
    userData: userData,                          // Startup script
});
```

**User Data Script**: This script runs when the EC2 instance starts:
1. Updates the operating system
2. Installs Docker
3. Runs CouchDB in a Docker container
4. Configures CouchDB for single-node operation
5. Sets up admin user and system databases

### 2. PostgreSQL Component (`components/postgresql.ts`)

**Purpose**: Stores the pool of available short codes.

#### Why PostgreSQL?
- **ACID compliance**: Ensures data consistency
- **Transactions**: Can safely allocate short codes without conflicts
- **Performance**: Fast queries for checking/updating short code availability

#### Key Parts:

**RDS Instance**:
```typescript
const dbInstance = new aws.rds.Instance(`${name}-instance`, {
    engine: "postgres",
    engineVersion: "17.5",
    instanceClass: args.instanceClass,      // db.t3.micro, db.t3.small, etc.
    allocatedStorage: args.allocatedStorage, // Disk space in GB
    storageEncrypted: true,                 // Encrypt data at rest
    backupRetentionPeriod: 7,              // Keep backups for 7 days
});
```

**Subnet Group**:
```typescript
const subnetGroup = new aws.rds.SubnetGroup(`${name}-subnet-group`, {
    subnetIds: args.subnetIds,  // Multiple subnets for high availability
});
```
**Why multiple subnets**: RDS requires subnets in at least 2 availability zones for automatic failover.

### 3. Redis Component (`components/redis.ts`)

**Purpose**: Caches frequently accessed URLs for faster response times.

#### Why Redis?
- **Speed**: In-memory storage = microsecond response times
- **TTL support**: Automatically expires old cache entries
- **Simple**: Key-value storage perfect for URL lookups

#### Key Parts:

**ElastiCache Cluster**:
```typescript
const cluster = new aws.elasticache.Cluster(`${name}-cluster`, {
    engine: "redis",
    nodeType: args.nodeType,           // cache.t3.micro, cache.t3.small, etc.
    numCacheNodes: 1,                  // Single node for simplicity
    snapshotRetentionLimit: 5,         // Keep backups
    snapshotWindow: "03:00-05:00",     // Backup during low-traffic hours
});
```

### 4. Application Server Component (`components/appserver.ts`)

**Purpose**: Runs the Node.js application that handles URL shortening and redirects.

#### Why Auto Scaling Group?
- **High Availability**: If one server fails, others continue serving
- **Scalability**: Automatically add/remove servers based on load
- **Updates**: Rolling deployments without downtime

#### Key Parts:

**Launch Template**:
```typescript
const launchTemplate = new aws.ec2.LaunchTemplate(`${name}-lt`, {
    imageId: ami.then(a => a.id),           // Amazon Linux 2
    instanceType: args.instanceType,         // t3.micro, t3.small, etc.
    userData: userData.apply(u => Buffer.from(u).toString('base64')), // Startup script
});
```

**Auto Scaling Group**:
```typescript
const asg = new aws.autoscaling.Group(`${name}-asg`, {
    vpcZoneIdentifiers: args.subnetIds,      // Deploy across multiple AZs
    targetGroupArns: [targetGroup.arn],      // Connect to load balancer
    healthCheckType: "ELB",                  // Load balancer determines health
    minSize: args.minSize,                   // Minimum servers (usually 1-2)
    maxSize: args.maxSize,                   // Maximum servers (usually 5-10)
    desiredCapacity: args.desiredCapacity,   // Normal number of servers
});
```

**Target Group**:
```typescript
const targetGroup = new aws.lb.TargetGroup(`${name}-tg`, {
    port: 3000,                              // App server port
    protocol: "HTTP",
    vpcId: args.vpcId,
    healthCheck: {
        path: "/health",                     // Health check endpoint
        matcher: "200",                      // Expected HTTP status
        interval: 30,                        // Check every 30 seconds
    },
});
```

**User Data Script**: This complex script:
1. Downloads and installs Node.js 16 (compatible with Amazon Linux 2)
2. Creates the complete Node.js application code
3. Installs dependencies (express, pg, redis, nano, etc.)
4. Creates environment configuration with database connection details
5. Sets up a systemd service for automatic startup and management
6. Starts the application and verifies it's working

### 5. Load Balancer Component (`components/loadbalancer.ts`)

**Purpose**: Distributes incoming traffic across multiple application servers.

#### Why Application Load Balancer?
- **High Availability**: Automatically routes around failed servers
- **SSL Termination**: Can handle HTTPS certificates
- **Health Checks**: Only sends traffic to healthy servers
- **Scaling**: Distributes load evenly across servers

#### Key Parts:

**Application Load Balancer**:
```typescript
const alb = new aws.lb.LoadBalancer(`${name}-alb`, {
    internal: false,                    // Internet-facing
    loadBalancerType: "application",    // Layer 7 (HTTP/HTTPS)
    securityGroups: [args.securityGroupId],
    subnets: args.subnetIds,           // Public subnets for internet access
});
```

**HTTP Listener**:
```typescript
const httpListener = new aws.lb.Listener(`${name}-http-listener`, {
    loadBalancerArn: alb.arn,
    port: 80,                          // Listen on port 80
    protocol: "HTTP",
    defaultActions: [{
        type: "forward",
        targetGroupArn: args.targetGroupArn,  // Forward to app servers
    }],
});
```

### 6. Debug Lambda Component (`components/debug-lambda.ts`)

**Purpose**: Provides a debugging tool to test connectivity between components.

#### Why Lambda?
- **Serverless**: Only runs when needed, no servers to manage
- **VPC Access**: Can test internal network connectivity
- **Cost Effective**: Pay only for execution time

The Lambda function can test:
- DNS resolution
- Port connectivity
- HTTP health checks

---

## Security & Networking

### Network Architecture

```
Internet Gateway
    ↓
Public Subnets (10.0.0.0/24, 10.0.1.0/24)
    ↓ [Load Balancer]
    ↓
NAT Gateways → Private Subnets (10.0.128.0/24, 10.0.129.0/24)
                    ↓ [App Servers]
                    ↓ [Databases]
```

### Security Layers

1. **Network Level**: VPC isolation, private subnets
2. **Application Level**: Security groups (firewalls)
3. **Access Level**: IAM roles and policies
4. **Data Level**: Encryption at rest and in transit

### IAM Roles and Policies

Each component gets only the permissions it needs:

**App Server Role**:
- Read CouchDB password from SSM Parameter Store
- Write logs to CloudWatch
- Basic EC2 metadata access

**CouchDB Role**:
- Session Manager access for debugging
- Basic EC2 operations

**Debug Lambda Role**:
- VPC access for network testing
- Basic Lambda execution permissions

---

## Deployment & Operations

### Configuration Management

All environment-specific settings are in `Pulumi.dev.yaml`:

```yaml
config:
  tinyurl:projectName: "tinyurl"
  tinyurl:environment: "dev"
  tinyurl:vpcCidr: "10.0.0.0/16"
  tinyurl:availabilityZones: ["eu-west-1a", "eu-west-1b"]
  tinyurl:appInstanceType: "t3.micro"
  tinyurl:appDesiredCapacity: 2
  tinyurl:postgresInstanceClass: "db.t3.micro"
  tinyurl:redisNodeType: "cache.t3.micro"
  aws:secretsPassword: "your-secure-password"
```

### Deployment Commands

```bash
# Deploy infrastructure
pulumi up

# View current state
pulumi stack output

# Destroy everything
pulumi destroy
```

### Monitoring and Logs

**CloudWatch Integration**:
- Application logs from EC2 instances
- RDS performance metrics
- ElastiCache metrics
- Load balancer access logs

**Health Checks**:
- Load balancer health checks on `/health` endpoint
- Auto Scaling Group health checks
- Database connectivity verification

### Cost Optimization

**Resource Sizing**:
- Use `t3.micro` instances for development (AWS free tier eligible)
- Scale up to `t3.small` or `t3.medium` for production load
- Use appropriate database instance classes

**Auto Scaling**:
- Scales down during low traffic periods
- Scales up automatically during high load
- CloudWatch alarms trigger scaling actions

---

## Outputs and Integration

### Application Endpoints

After deployment, Pulumi provides these outputs:

```typescript
export const tinyurlAppUrl = pulumi.interpolate`http://${loadBalancer.dnsName}`;
export const postgresEndpoint = postgres.endpoint;
export const redisEndpoint = redis.endpoint;
export const couchdbEndpoint = couchdb.endpoint;
```

**Usage**:
- `tinyurlAppUrl`: Public URL to access the application
- Database endpoints: Used by application servers for connections

### Integration with Application

The Node.js application receives database connection details through environment variables:

```bash
POSTGRES_HOST=tinyurl-postgres.xxxxx.eu-west-1.rds.amazonaws.com
POSTGRES_PORT=5432
REDIS_HOST=tinyurl-redis.xxxxx.0001.euw1.cache.amazonaws.com
COUCHDB_HOST=10.0.37.125
COUCHDB_PASSWORD=URLSafePassword123
```

---

## Troubleshooting Common Issues

### 1. Instance Not Starting
**Check**: User data logs in `/var/log/user-data.log`
**Common causes**: Download failures, dependency conflicts

### 2. Database Connection Failures
**Check**: Security group rules, subnet routing
**Common causes**: Wrong security group, network ACLs

### 3. Load Balancer Health Check Failures
**Check**: Application `/health` endpoint, target group configuration
**Common causes**: App not starting, wrong health check path

### 4. Auto Scaling Issues
**Check**: CloudWatch metrics, scaling policies
**Common causes**: Incorrect thresholds, insufficient capacity

---

## Best Practices

### Development
1. **Use small instance types** (`t3.micro`) to minimize costs
2. **Enable detailed monitoring** for debugging
3. **Use consistent naming** with project prefix
4. **Tag all resources** with environment and project

### Production
1. **Use multiple availability zones** for high availability
2. **Enable backup retention** for databases
3. **Implement proper monitoring** and alerting
4. **Use HTTPS** with SSL certificates
5. **Regular security updates** for EC2 instances

### Security
1. **Principle of least privilege** for IAM roles
2. **Regular password rotation** for database credentials
3. **Network segmentation** with private subnets
4. **Encryption at rest** for all data stores

---

This infrastructure setup provides a robust, scalable foundation for the TinyURL application with proper security, monitoring, and operational practices built in from the start.