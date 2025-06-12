# Networking and Security Architecture: Complete Deep Dive

This document provides an exhaustive explanation of every networking and security decision in the TinyURL infrastructure, including packet flows, firewall rules, and security best practices.

## Table of Contents

1. [VPC Architecture: Every Component](#vpc-architecture-every-component)
2. [Subnet Design: Complete Analysis](#subnet-design-complete-analysis)
3. [Security Groups: Every Rule Explained](#security-groups-every-rule-explained)
4. [Network Traffic Flows: Packet by Packet](#network-traffic-flows-packet-by-packet)
5. [IAM Security: Every Permission](#iam-security-every-permission)
6. [Encryption and Data Protection](#encryption-and-data-protection)
7. [Attack Scenarios and Mitigations](#attack-scenarios-and-mitigations)

---

## VPC Architecture: Every Component

### What is a VPC?

A Virtual Private Cloud (VPC) is like having your own private network within AWS. Think of it as:
- **Traditional**: Your office building with its own internal network
- **VPC**: Your virtual building in AWS's data center

### VPC Components Created by Our Code

```typescript
const vpc = new awsx.ec2.Vpc(`${projectName}-vpc`, {
    cidrBlock: vpcCidr,
    numberOfAvailabilityZones: availabilityZones.length,
    enableDnsHostnames: true,
    enableDnsSupport: true,
});
```

This single block of code creates 13 different AWS resources:

#### 1. VPC Resource
```
Resource: aws:ec2:Vpc
Name: tinyurl-vpc
CIDR: 10.0.0.0/16
DNS Hostnames: Enabled
DNS Support: Enabled
```

**What this means**:
- IP range: 10.0.0.0 to 10.0.255.255 (65,536 IPs)
- DNS hostnames: EC2 instances get names like ip-10-0-0-5.eu-west-1.compute.internal
- DNS support: Can resolve AWS service endpoints

#### 2. Internet Gateway
```
Resource: aws:ec2:InternetGateway
Name: tinyurl-vpc
Purpose: Allows VPC to communicate with internet
```

**How it works**:
1. Attached to VPC
2. Routes traffic between VPC and internet
3. Performs NAT for instances with public IPs
4. Stateful: Remembers connections

#### 3. Public Subnets (2)
```
Resource: aws:ec2:Subnet
Names: tinyurl-vpc-public-1, tinyurl-vpc-public-2
CIDRs: 10.0.0.0/24, 10.0.1.0/24
Type: Public (has route to Internet Gateway)
```

**Characteristics**:
- Direct internet access via Internet Gateway
- Instances get public IPs by default
- Used for: Load balancers, NAT gateways
- One per availability zone for redundancy

#### 4. Private Subnets (2)
```
Resource: aws:ec2:Subnet
Names: tinyurl-vpc-private-1, tinyurl-vpc-private-2
CIDRs: 10.0.128.0/24, 10.0.129.0/24
Type: Private (no direct internet route)
```

**Characteristics**:
- No direct internet access
- Outbound internet via NAT Gateway
- Used for: Applications, databases
- More secure: Can't be directly accessed from internet

#### 5. NAT Gateways (2)
```
Resource: aws:ec2:NatGateway
Names: tinyurl-vpc-1, tinyurl-vpc-2
Location: Public subnets
Purpose: Allow private instances to reach internet
```

**How NAT works**:
1. Private instance sends packet to internet
2. NAT Gateway replaces source IP with its own
3. Internet responds to NAT Gateway
4. NAT Gateway forwards to private instance

**Why 2 NAT Gateways**: High availability - if one AZ fails, other continues

#### 6. Elastic IPs (2)
```
Resource: aws:ec2:Eip
Names: tinyurl-vpc-1, tinyurl-vpc-2
Purpose: Static IPs for NAT Gateways
```

**Why needed**: NAT Gateways need static public IPs

#### 7. Route Tables (4)
```
Public Route Tables (2):
- tinyurl-vpc-public-1
- tinyurl-vpc-public-2

Private Route Tables (2):
- tinyurl-vpc-private-1
- tinyurl-vpc-private-2
```

**Public route table**:
```
Destination     Target              Purpose
10.0.0.0/16    local               Traffic within VPC
0.0.0.0/0      igw-xxxxx          All other traffic to internet
```

**Private route table**:
```
Destination     Target              Purpose
10.0.0.0/16    local               Traffic within VPC
0.0.0.0/0      nat-xxxxx          All other traffic to NAT
```

#### 8. Routes (6)
Individual route entries in the route tables

#### 9. Route Table Associations (4)
Links subnets to route tables

### CIDR Block Deep Dive

```
VPC CIDR: 10.0.0.0/16
```

**Binary breakdown**:
```
10.0.0.0 in binary: 00001010.00000000.00000000.00000000
Netmask /16:        11111111.11111111.00000000.00000000
                    └── Fixed ──┘└── Variable ──┘
```

**This means**:
- First 16 bits are fixed (10.0)
- Last 16 bits are variable (0.0 to 255.255)
- Total addresses: 2^16 = 65,536

**Subnet allocation**:
```
Public Subnet 1:  10.0.0.0/24    (10.0.0.0 - 10.0.0.255)     256 IPs
Public Subnet 2:  10.0.1.0/24    (10.0.1.0 - 10.0.1.255)     256 IPs
Private Subnet 1: 10.0.128.0/24  (10.0.128.0 - 10.0.128.255) 256 IPs
Private Subnet 2: 10.0.129.0/24  (10.0.129.0 - 10.0.129.255) 256 IPs
```

**Why this design**:
- Public: 10.0.0.x - Easy to remember as "start of range"
- Private: 10.0.128.x - Clearly separated (128 is 10000000 in binary)
- Room for growth: Can add 252 more subnets

---

## Subnet Design: Complete Analysis

### Public Subnet Characteristics

```typescript
// Created automatically by awsx.ec2.Vpc
publicSubnetIds: ["subnet-xxx", "subnet-yyy"]
```

**What makes them public**:
1. Route to Internet Gateway in route table
2. Auto-assign public IP enabled
3. Network ACLs allow internet traffic

**What goes here**:
- Application Load Balancers
- NAT Gateways
- Bastion hosts (if needed)
- Public-facing services

**IP allocation**:
```
Total IPs: 256
AWS Reserved: 5
- .0: Network address
- .1: VPC router
- .2: AWS DNS
- .3: Reserved for future
- .255: Broadcast
Available: 251
```

### Private Subnet Characteristics

```typescript
// Created automatically by awsx.ec2.Vpc
privateSubnetIds: ["subnet-aaa", "subnet-bbb"]
```

**What makes them private**:
1. No route to Internet Gateway
2. Route to NAT Gateway for outbound
3. No public IPs assigned

**What goes here**:
- Application servers
- Databases
- Internal services
- Lambda functions (with VPC config)

**Security benefits**:
- Can't be directly accessed from internet
- Must go through load balancer
- Reduces attack surface

### Availability Zone Distribution

```
AZ 1 (eu-west-1a):          AZ 2 (eu-west-1b):
┌─────────────────┐         ┌─────────────────┐
│ Public Subnet 1 │         │ Public Subnet 2 │
│   10.0.0.0/24   │         │   10.0.1.0/24   │
├─────────────────┤         ├─────────────────┤
│ Private Subnet 1│         │ Private Subnet 2│
│  10.0.128.0/24  │         │  10.0.129.0/24  │
└─────────────────┘         └─────────────────┘
```

**Why multiple AZs**:
- Hardware failure: If AZ1 fails, AZ2 continues
- Maintenance: AWS can update one AZ at a time
- Natural disasters: AZs are physically separated
- Network issues: Independent network paths

---

## Security Groups: Every Rule Explained

### Understanding Security Groups

Security Groups are like virtual firewalls that control traffic at the instance level:
- **Stateful**: Return traffic automatically allowed
- **Default deny**: Only explicitly allowed traffic passes
- **Multiple allowed**: Instance can have multiple security groups

### Application Load Balancer Security Group

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
        {
            fromPort: 443,
            toPort: 443,
            protocol: "tcp",
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
});
```

**Ingress Rules Explained**:

Rule 1: HTTP Traffic
```
fromPort: 80        # Standard HTTP port
toPort: 80          # Same port (not a range)
protocol: "tcp"     # HTTP uses TCP
cidrBlocks: ["0.0.0.0/0"]  # From anywhere on internet
```

Rule 2: HTTPS Traffic
```
fromPort: 443       # Standard HTTPS port
toPort: 443         # Same port
protocol: "tcp"     # HTTPS uses TCP
cidrBlocks: ["0.0.0.0/0"]  # From anywhere
```

**Egress Rule Explained**:
```
fromPort: 0         # All ports (0 = any)
toPort: 0           # All ports
protocol: "-1"      # All protocols (TCP, UDP, ICMP, etc.)
cidrBlocks: ["0.0.0.0/0"]  # To anywhere
```

**Why allow all egress**: ALB needs to reach app servers on various ports

### Application Server Security Group

```typescript
const appSecurityGroup = new aws.ec2.SecurityGroup(`${projectName}-app-sg`, {
    description: "Security group for application servers",
    vpcId: vpc.vpcId,
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
});
```

**No ingress rules?** They're added separately for flexibility:

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

**This rule means**:
- Only the load balancer can reach app servers
- Only on port 3000
- Only TCP protocol
- Source is security group, not IP range

**Why use security group as source**:
- More secure: IPs can change
- Automatic: Works even if ALB gets new IPs
- Clear intent: "Only from load balancer"

### Database Security Group

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
});
```

**Individual database rules**:

PostgreSQL Rule:
```typescript
new aws.ec2.SecurityGroupRule("postgres-ingress", {
    type: "ingress",
    fromPort: 5432,      // PostgreSQL default port
    toPort: 5432,
    protocol: "tcp",
    sourceSecurityGroupId: appSecurityGroup.id,  // Only from app servers
    securityGroupId: databaseSecurityGroup.id,
});
```

Redis Rule:
```typescript
new aws.ec2.SecurityGroupRule("redis-ingress", {
    type: "ingress",
    fromPort: 6379,      // Redis default port
    toPort: 6379,
    protocol: "tcp",
    sourceSecurityGroupId: appSecurityGroup.id,
    securityGroupId: databaseSecurityGroup.id,
});
```

CouchDB Rule:
```typescript
new aws.ec2.SecurityGroupRule("couchdb-ingress", {
    type: "ingress",
    fromPort: 5984,      // CouchDB HTTP API port
    toPort: 5984,
    protocol: "tcp",
    sourceSecurityGroupId: appSecurityGroup.id,
    securityGroupId: databaseSecurityGroup.id,
});
```

### Security Group Evaluation

When a packet arrives, AWS evaluates rules:

1. **Ingress evaluation**:
   ```
   for each security group on instance:
       for each ingress rule in security group:
           if packet matches rule:
               ALLOW packet
   DENY packet  // No match found
   ```

2. **Egress evaluation**:
   ```
   for each security group on instance:
       for each egress rule in security group:
           if packet matches rule:
               ALLOW packet
   DENY packet  // No match found
   ```

3. **Stateful tracking**:
   - Connection tracked in state table
   - Return traffic automatically allowed
   - No need for explicit return rules

---

## Network Traffic Flows: Packet by Packet

Let's trace complete network flows through the infrastructure:

### Flow 1: User Requests Short URL

```
1. User Browser → Internet → AWS Edge
   Packet: [SRC: User IP:12345 | DST: ALB IP:80 | DATA: GET /Abc123]

2. AWS Edge → Internet Gateway
   - Checks: Is destination in this VPC?
   - Action: Route to ALB in public subnet

3. Internet Gateway → ALB Security Group
   - Check: Is port 80 from 0.0.0.0/0 allowed? YES
   - Action: Pass to ALB

4. ALB → Target Group
   - Action: Choose healthy app server
   - Modify: Add X-Forwarded-For header

5. ALB → App Security Group
   Packet: [SRC: ALB IP:45678 | DST: App IP:3000 | DATA: GET /Abc123]
   - Check: Is port 3000 from ALB SG allowed? YES
   - Action: Pass to app server

6. App Server → Redis Security Group
   Packet: [SRC: App IP:34567 | DST: Redis IP:6379 | DATA: GET url:Abc123]
   - Check: Is port 6379 from App SG allowed? YES
   - Action: Query Redis

7. Redis → App Server (Stateful return)
   - No security group check needed
   - Returns: Cache miss

8. App Server → CouchDB Security Group
   Packet: [SRC: App IP:34567 | DST: CouchDB IP:5984 | DATA: GET /_find]
   - Check: Is port 5984 from App SG allowed? YES
   - Action: Query CouchDB

9. CouchDB → App Server (Stateful return)
   - Returns: {long_url: "https://example.com"}

10. App Server → ALB (Stateful return)
    Response: 302 Redirect to https://example.com

11. ALB → User (Through Internet Gateway)
    - Removes X-Forwarded headers
    - Returns redirect to user
```

### Flow 2: App Server Software Update

```
1. App Server → NAT Gateway
   Packet: [SRC: App IP:45678 | DST: nodejs.org:443 | DATA: GET package]
   - Route table: 0.0.0.0/0 → NAT Gateway

2. NAT Gateway → Internet Gateway
   - SNAT: Replace source with NAT Gateway IP
   Packet: [SRC: NAT IP:45678 | DST: nodejs.org:443 | DATA: GET package]

3. Internet → nodejs.org
   - nodejs.org sees request from NAT Gateway IP

4. nodejs.org → NAT Gateway
   Response: [SRC: nodejs.org:443 | DST: NAT IP:45678 | DATA: package.tar.gz]

5. NAT Gateway → App Server
   - DNAT: Replace destination with original App IP
   - State table lookup: Find original connection
   Response: [SRC: nodejs.org:443 | DST: App IP:45678 | DATA: package.tar.gz]
```

### Flow 3: Database Replication (If Multi-AZ)

```
1. Primary RDS → Secondary RDS
   Packet: [SRC: RDS1 IP:5432 | DST: RDS2 IP:5432 | DATA: WAL logs]
   - Internal AWS network
   - Bypasses security groups (AWS managed)

2. Synchronous replication:
   - Every transaction waits for acknowledgment
   - Sub-millisecond latency within region
   - Automatic failover if primary fails
```

---

## IAM Security: Every Permission

### Understanding IAM

IAM (Identity and Access Management) controls who can do what in AWS:
- **Principal**: Who (user, role, service)
- **Action**: What (ec2:StartInstance, s3:GetObject)
- **Resource**: On what (specific instance, bucket)
- **Condition**: When (IP address, time, MFA)

### App Server IAM Role

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
});
```

**Assume Role Policy Explained**:
- `Version`: Policy language version (always "2012-10-17")
- `Action: "sts:AssumeRole"`: Allows assuming this role
- `Principal: ec2.amazonaws.com`: Only EC2 service can assume
- This is the "trust policy" - who can use the role

### SSM Parameter Access Policy

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

**Each permission explained**:

`ssm:GetParameter`:
- Read single parameter
- Used for: Getting CouchDB password
- Example: `aws ssm get-parameter --name /tinyurl/dev/couchdb/admin_password`

`ssm:GetParameters`:
- Read multiple parameters
- Used for: Batch operations
- More efficient than multiple GetParameter calls

**Resource restriction**:
```
arn:aws:ssm:*:*:parameter/tinyurl/dev/*
│    │   │   │ │         └─ Only parameters under this path
│    │   │   │ └─ Resource type
│    │   │   └─ Account ID (* = any)
│    │   └─ Region (* = any)
│    └─ Service
└─ ARN prefix
```

### CloudWatch Logs Policy

```typescript
{
    Effect: "Allow",
    Action: [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
    ],
    Resource: "*",
}
```

**Each permission explained**:

`logs:CreateLogGroup`:
- Create new log group
- First time application starts
- Groups logs by application/service

`logs:CreateLogStream`:
- Create stream within group
- Usually one per instance/container
- Timestamp-based naming

`logs:PutLogEvents`:
- Write actual log entries
- Batched for efficiency
- Includes timestamp and message

`logs:DescribeLogStreams`:
- List existing streams
- Find where to write
- Resume after restart

### Session Manager Policy

```typescript
new aws.iam.RolePolicyAttachment(`${name}-ssm-session-manager-attachment`, {
    role: role.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
});
```

**What this managed policy includes**:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ssm:UpdateInstanceInformation",
                "ssmmessages:CreateControlChannel",
                "ssmmessages:CreateDataChannel",
                "ssmmessages:OpenControlChannel",
                "ssmmessages:OpenDataChannel",
                "ec2messages:*"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject"
            ],
            "Resource": "arn:aws:s3:::aws-ssm-region/*"
        }
    ]
}
```

**Why these permissions**:
- Register instance with Systems Manager
- Create secure WebSocket channels
- Download SSM agent updates

---

## Encryption and Data Protection

### Encryption at Rest

#### RDS Encryption
```typescript
storageEncrypted: true,
```
**How it works**:
1. AWS KMS generates data encryption key (DEK)
2. DEK encrypts database storage
3. Customer Master Key (CMK) encrypts DEK
4. Transparent to application

**What's encrypted**:
- Database files
- Backups
- Snapshots
- Transaction logs
- Read replicas

#### EBS Volume Encryption
```typescript
rootBlockDevice: {
    volumeSize: 30,
    volumeType: "gp3",
    encrypted: true,
},
```
**Encryption process**:
1. Create volume with encryption enabled
2. AWS generates unique DEK per volume
3. All data written is encrypted
4. Includes snapshots

#### SSM Parameter Encryption
```typescript
type: "SecureString",
```
**Uses AWS KMS**:
- Parameters encrypted at rest
- Decrypted only when retrieved
- Audit trail in CloudTrail

### Encryption in Transit

#### TLS/SSL for RDS
```typescript
ssl: {
    rejectUnauthorized: false
}
```
**Connection encryption**:
1. App initiates TLS handshake
2. RDS presents certificate
3. Encrypted tunnel established
4. All queries/results encrypted

**Note**: In production, use proper certificate validation

#### HTTPS for Application
Currently HTTP only, but ready for HTTPS:
```typescript
{
    fromPort: 443,
    toPort: 443,
    protocol: "tcp",
    cidrBlocks: ["0.0.0.0/0"],
},
```

**To enable HTTPS**:
1. Obtain SSL certificate (ACM or third-party)
2. Add HTTPS listener to ALB
3. Configure SSL policy
4. Redirect HTTP to HTTPS

### Data Protection Best Practices

#### Password Management
```typescript
// Good: Generate secure passwords
const adminPassword = new random.RandomPassword(`${name}-admin-password`, {
    length: 32,
    special: false,  // Avoid URL encoding issues
    upper: true,
    lower: true,
    numeric: true,
});

// Good: Store in SSM
new aws.ssm.Parameter(`${name}-admin-password-param`, {
    type: "SecureString",
    value: adminPassword.result,
});

// Good: Retrieve securely
COUCHDB_PASSWORD=$(aws ssm get-parameter \
    --name "path" \
    --with-decryption \
    --query 'Parameter.Value' \
    --output text)
```

#### Secrets in Code
```typescript
// Bad: Hardcoded password
const password = "myPassword123";

// Good: From configuration
const password = config.requireSecret("dbPassword");

// Good: From environment
const password = process.env.DB_PASSWORD;
```

---

## Attack Scenarios and Mitigations

### Scenario 1: DDoS Attack

**Attack**: Flood of requests to overwhelm application

**Current Mitigations**:
1. **ALB**: Distributes load across instances
2. **Auto Scaling**: Adds instances under load
3. **Security Groups**: Only allow necessary ports

**Additional Mitigations**:
```typescript
// AWS Shield Standard (free, automatic)
// AWS Shield Advanced (paid, additional protection)
// AWS WAF rules
new aws.wafv2.WebAcl("waf", {
    scope: "REGIONAL",
    defaultAction: { allow: {} },
    rules: [{
        name: "RateLimitRule",
        priority: 1,
        statement: {
            rateBasedStatement: {
                limit: 2000,  // requests per 5 minutes
                aggregateKeyType: "IP",
            },
        },
        action: { block: {} },
    }],
});
```

### Scenario 2: SQL Injection

**Attack**: Malicious SQL in URL parameter

**Current Mitigations**:
1. **Parameterized queries**:
   ```javascript
   await pgPool.query(
       'UPDATE short_codes SET used = true WHERE short_code = $1',
       [shortCode]  // Parameterized, not concatenated
   );
   ```

2. **Input validation** (should add):
   ```javascript
   if (!/^[a-zA-Z0-9]{8}$/.test(shortCode)) {
       return res.status(400).json({ error: 'Invalid short code' });
   }
   ```

### Scenario 3: Brute Force Password Attack

**Attack**: Try many passwords for CouchDB admin

**Current Mitigations**:
1. **32-character random password**
2. **No external access** (private subnet)
3. **Security group** restrictions

**Additional Mitigations**:
```typescript
// Fail2ban on instance
// CloudWatch alarm on failed auth
new aws.cloudwatch.MetricAlarm("failed-auth-alarm", {
    metricName: "FailedAuthentications",
    namespace: "CouchDB",
    statistic: "Sum",
    period: 300,
    evaluationPeriods: 1,
    threshold: 10,
    comparisonOperator: "GreaterThanThreshold",
});
```

### Scenario 4: Instance Compromise

**Attack**: Attacker gains shell access to EC2 instance

**Current Mitigations**:
1. **IAM roles**: Limited permissions
2. **Private subnets**: No direct internet access
3. **Security groups**: Restrict lateral movement

**Additional Mitigations**:
1. **Systems Manager Session Manager**: No SSH keys
2. **CloudWatch Logs**: Monitor commands
3. **AWS GuardDuty**: Detect anomalies
4. **Regular patching**: Keep systems updated

### Scenario 5: Data Exfiltration

**Attack**: Steal database contents

**Current Mitigations**:
1. **Encryption at rest**: Data encrypted on disk
2. **Network isolation**: Databases in private subnet
3. **Access control**: Only app servers can connect

**Additional Mitigations**:
```typescript
// VPC Flow Logs
new aws.ec2.FlowLog("vpc-flow-log", {
    logDestinationType: "cloud-watch-logs",
    resourceId: vpc.vpcId,
    resourceType: "VPC",
    trafficType: "ALL",
});

// Database Activity Monitoring
// Enable RDS Enhanced Monitoring
// Query logging in PostgreSQL
```

### Scenario 6: Cross-Site Scripting (XSS)

**Attack**: Inject JavaScript in URLs

**Current Mitigations**:
1. **Helmet.js**: Security headers
   ```
   X-XSS-Protection: 1; mode=block
   X-Content-Type-Options: nosniff
   ```

**Additional Mitigations**:
```javascript
// Sanitize URLs before storing
const sanitizeUrl = (url) => {
    // Remove javascript: protocol
    if (url.toLowerCase().startsWith('javascript:')) {
        throw new Error('Invalid URL');
    }
    // Validate URL format
    new URL(url);  // Throws if invalid
    return url;
};
```

### Security Monitoring and Alerting

#### CloudTrail for API Calls
```typescript
new aws.cloudtrail.Trail("api-trail", {
    s3BucketName: auditBucket.id,
    eventSelectors: [{
        readWriteType: "All",
        includeManagementEvents: true,
        dataResources: [{
            type: "AWS::RDS::DBCluster",
            values: ["arn:aws:rds:*:*:*"],
        }],
    }],
});
```

#### GuardDuty for Threat Detection
```typescript
new aws.guardduty.Detector("threat-detector", {
    enable: true,
    findingPublishingFrequency: "FIFTEEN_MINUTES",
});
```

#### Config for Compliance
```typescript
new aws.cfg.Rule("required-tags", {
    source: {
        owner: "AWS",
        sourceIdentifier: "REQUIRED_TAGS",
    },
    inputParameters: JSON.stringify({
        tag1Key: "Environment",
        tag2Key: "Project",
    }),
});
```

This comprehensive guide covers every aspect of networking and security in the TinyURL infrastructure, from basic concepts to advanced attack scenarios and mitigations.