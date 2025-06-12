# TinyURL Infrastructure: Complete Troubleshooting Guide

This guide covers every possible issue you might encounter with the TinyURL infrastructure, including root cause analysis, debugging steps, and solutions.

## Table of Contents

1. [Deployment Issues](#deployment-issues)
2. [Runtime Issues](#runtime-issues)
3. [Performance Problems](#performance-problems)
4. [Security Incidents](#security-incidents)
5. [Database Issues](#database-issues)
6. [Networking Problems](#networking-problems)
7. [Cost Optimization](#cost-optimization)
8. [Disaster Recovery](#disaster-recovery)

---

## Deployment Issues

### Issue: Pulumi Update Fails

#### Symptom 1: "Resource already exists"
```
error: aws:ec2/instance:Instance resource 'couchdb-instance' 
has a problem: InvalidInstanceID.NotFound: The instance ID 'i-xxxxx' does not exist
```

**Root Cause**: Resource exists in AWS but not in Pulumi state

**Diagnosis**:
```bash
# Check if resource exists in AWS
aws ec2 describe-instances --instance-ids i-xxxxx

# Check Pulumi state
pulumi stack export | grep i-xxxxx
```

**Solutions**:

Option 1: Refresh state
```bash
pulumi refresh --yes
pulumi up --yes
```

Option 2: Import existing resource
```bash
pulumi import aws:ec2/instance:Instance couchdb-instance i-xxxxx
```

Option 3: Delete and recreate
```bash
# Manually delete in AWS Console
aws ec2 terminate-instances --instance-ids i-xxxxx
# Wait for termination
pulumi refresh --yes
pulumi up --yes
```

#### Symptom 2: "VPC CIDR conflicts"
```
error: creating EC2 VPC: InvalidVpc.Range: 
The CIDR '10.0.0.0/16' conflicts with another subnet
```

**Root Cause**: VPC CIDR overlaps with existing VPC

**Diagnosis**:
```bash
# List all VPCs and their CIDRs
aws ec2 describe-vpcs --query 'Vpcs[*].[VpcId,CidrBlock]' --output table
```

**Solution**: Change CIDR in Pulumi config
```yaml
# Pulumi.dev.yaml
config:
  tinyurl:vpcCidr: "172.16.0.0/16"  # Different range
```

#### Symptom 3: "Invalid instance type"
```
error: Your requested instance type (t3.micro) is not supported in your requested Availability Zone
```

**Root Cause**: Instance type not available in AZ

**Diagnosis**:
```bash
# Check available instance types in AZ
aws ec2 describe-instance-type-offerings \
  --filters "Name=instance-type,Values=t3.micro" \
  --query 'InstanceTypeOfferings[*].[InstanceType,Location]' \
  --output table
```

**Solution**: Use different instance type or AZ
```yaml
# Option 1: Different instance type
config:
  tinyurl:appInstanceType: "t3.small"

# Option 2: Different AZs
config:
  tinyurl:availabilityZones:
    - "eu-west-1b"  # Instead of eu-west-1a
    - "eu-west-1c"
```

### Issue: User Data Script Failures

#### Symptom: "Node.js installation failed"
```
ERROR: Node.js installation failed!
```

**Root Cause Analysis**:
1. Network timeout downloading Node.js
2. Disk space insufficient
3. DNS resolution failing

**Diagnosis Steps**:

Step 1: Access instance
```bash
# Get instance ID
INSTANCE_ID=$(pulumi stack output appServerInstanceId)

# Connect via Session Manager
aws ssm start-session --target $INSTANCE_ID
```

Step 2: Check user data log
```bash
sudo cat /var/log/user-data.log | grep -A 10 -B 10 ERROR
```

Step 3: Check specific issues
```bash
# Disk space
df -h

# Network connectivity
curl -I https://nodejs.org

# DNS resolution
nslookup nodejs.org
```

**Solutions**:

For network issues:
```bash
# In user data script, add retry logic
for i in {1..3}; do
    if curl -fsSL ${NODE_URL} -o node.tar.xz; then
        break
    fi
    echo "Download attempt $i failed, retrying..."
    sleep 10
done
```

For disk space:
```typescript
// Increase root volume size
rootBlockDevice: {
    volumeSize: 50,  // Increased from 30
    volumeType: "gp3",
    encrypted: true,
},
```

---

## Runtime Issues

### Issue: 502 Bad Gateway

#### Complete Diagnosis Flow

Step 1: Check Load Balancer Target Health
```bash
# Get target group ARN
TG_ARN=$(aws elbv2 describe-target-groups \
  --names tinyurl-app-tg \
  --query 'TargetGroups[0].TargetGroupArn' \
  --output text)

# Check target health
aws elbv2 describe-target-health \
  --target-group-arn $TG_ARN \
  --query 'TargetHealthDescriptions[*].[Target.Id,TargetHealth.State,TargetHealth.Reason]' \
  --output table
```

**Possible outputs**:
```
healthy     - Target is passing health checks
unhealthy   - Target is failing health checks
initial     - Target is still initializing
draining    - Target is de-registering
unused      - Target is not registered
```

Step 2: Check Application Logs
```bash
# Get unhealthy instance ID
INSTANCE_ID="i-xxxxx"

# Check application status
aws ssm send-command \
  --instance-ids $INSTANCE_ID \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["systemctl status nodeapp","journalctl -u nodeapp -n 50"]' \
  --output text

# Get command output
aws ssm get-command-invocation \
  --command-id $COMMAND_ID \
  --instance-id $INSTANCE_ID \
  --query 'StandardOutputContent' \
  --output text
```

Step 3: Test Health Endpoint Directly
```bash
# From within VPC (using Lambda or another instance)
curl -v http://10.0.x.x:3000/health
```

**Common root causes and fixes**:

1. **Database Connection Failed**
```
Error: connect ECONNREFUSED 10.0.x.x:5432
```
Fix: Check security groups, database status

2. **Node.js Not Running**
```
Unit nodeapp.service could not be found
```
Fix: Check user data execution, Node.js installation

3. **Wrong Environment Variables**
```
Error: ENOTFOUND redis.cluster
```
Fix: Verify environment file contents

### Issue: Application Can't Connect to Database

#### PostgreSQL Connection Issues

**Error Message**:
```
Error: connect ETIMEDOUT 10.0.34.567:5432
```

**Complete Diagnosis**:

1. Check RDS Status
```bash
aws rds describe-db-instances \
  --db-instance-identifier tinyurl-postgres \
  --query 'DBInstances[0].[DBInstanceStatus,Endpoint]'
```

2. Check Security Groups
```bash
# Get RDS security groups
aws rds describe-db-instances \
  --db-instance-identifier tinyurl-postgres \
  --query 'DBInstances[0].VpcSecurityGroups[*].VpcSecurityGroupId' \
  --output text

# Check security group rules
aws ec2 describe-security-groups \
  --group-ids sg-xxxxx \
  --query 'SecurityGroups[0].IpPermissions'
```

3. Test Network Connectivity
```bash
# From app server
nc -zv postgres-endpoint 5432
```

4. Check SSL/TLS Requirements
```javascript
// If RDS requires SSL but app doesn't use it
const pgPool = new Pool({
    ssl: {
        rejectUnauthorized: false  // Add this
    }
});
```

#### Redis Connection Issues

**Error Message**:
```
Error: Redis connection to redis-cluster.xxxxx.cache.amazonaws.com:6379 failed
```

**Diagnosis**:
```bash
# Check ElastiCache status
aws elasticache describe-cache-clusters \
  --cache-cluster-id tinyurl-redis \
  --show-cache-node-info

# Test from app server
redis-cli -h redis-endpoint ping
```

**Common Issues**:
1. **Cluster still creating**: Wait for "available" status
2. **Wrong endpoint**: Use cluster endpoint, not node endpoint
3. **Security group**: Ensure port 6379 is allowed

#### CouchDB Authentication Issues

**Error Message**:
```
Error: Name or password is incorrect
```

**Complete Diagnosis**:

1. Check CouchDB Container
```bash
# On CouchDB instance
docker ps -a
docker logs couchdb
```

2. Verify Password in SSM
```bash
aws ssm get-parameter \
  --name "/tinyurl/dev/couchdb/admin_password" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text
```

3. Test Authentication
```bash
# Get password
PASS=$(aws ssm get-parameter ...)

# Test direct connection
curl -u admin:$PASS http://couchdb-ip:5984/_all_dbs
```

4. Check Environment Variables
```bash
# On app server
cat /opt/app/.env | grep COUCHDB
```

---

## Performance Problems

### Issue: High Response Times

#### Diagnosis Framework

1. **Identify Bottleneck Layer**
```bash
# Check ALB metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name TargetResponseTime \
  --dimensions Name=LoadBalancer,Value=app/tinyurl-alb/xxxxx \
  --statistics Average \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T01:00:00Z \
  --period 300
```

2. **Application Server Metrics**
```bash
# CPU utilization
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUUtilization \
  --dimensions Name=AutoScalingGroupName,Value=tinyurl-app-asg \
  --statistics Average \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T01:00:00Z \
  --period 300

# Memory usage (requires CloudWatch agent)
free -m
top -b -n 1 | head -20
```

3. **Database Performance**
```sql
-- PostgreSQL slow queries
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- Current connections
SELECT count(*) FROM pg_stat_activity;

-- Lock waits
SELECT blocked_locks.pid AS blocked_pid,
       blocked_activity.usename AS blocked_user,
       blocking_locks.pid AS blocking_pid,
       blocking_activity.usename AS blocking_user
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

#### Common Performance Issues

1. **N+1 Query Problem**
```javascript
// Bad: Multiple queries
for (const code of shortCodes) {
    const result = await pgPool.query('SELECT * FROM urls WHERE code = $1', [code]);
}

// Good: Single query
const result = await pgPool.query(
    'SELECT * FROM urls WHERE code = ANY($1)', 
    [shortCodes]
);
```

2. **Missing Database Indexes**
```sql
-- Check existing indexes
\di

-- Add missing index
CREATE INDEX idx_urls_created_at ON urls(created_at);
```

3. **Connection Pool Exhaustion**
```javascript
// Check pool stats
console.log('Total:', pgPool.totalCount);
console.log('Idle:', pgPool.idleCount);
console.log('Waiting:', pgPool.waitingCount);

// Increase pool size
const pgPool = new Pool({
    max: 20,  // Default is 10
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
```

### Issue: Auto Scaling Not Working

**Symptoms**: High CPU but no new instances

**Diagnosis**:
```bash
# Check scaling activities
aws autoscaling describe-scaling-activities \
  --auto-scaling-group-name tinyurl-app-asg \
  --max-records 10

# Check scaling policies
aws autoscaling describe-policies \
  --auto-scaling-group-name tinyurl-app-asg

# Check CloudWatch alarms
aws cloudwatch describe-alarms \
  --alarm-names tinyurl-cpu-high
```

**Common Issues**:

1. **Cooldown Period**: Wait 300 seconds between scaling
2. **Max Capacity Reached**: Already at maximum instances
3. **Alarm Not Triggering**: Threshold not met for required periods
4. **Insufficient Capacity**: No instances available in AZ

---

## Security Incidents

### Issue: Suspected Breach

#### Immediate Response Checklist

1. **Isolate Affected Resources**
```bash
# Change security group to block all traffic
aws ec2 modify-instance-attribute \
  --instance-id i-xxxxx \
  --groups sg-emergency-lockdown

# Create emergency security group
aws ec2 create-security-group \
  --group-name emergency-lockdown \
  --description "No ingress, limited egress"
```

2. **Preserve Evidence**
```bash
# Create EBS snapshot
aws ec2 create-snapshot \
  --volume-id vol-xxxxx \
  --description "Security incident $(date)"

# Export logs
aws logs create-export-task \
  --log-group-name /aws/ec2/app \
  --from $(date -d '7 days ago' +%s)000 \
  --to $(date +%s)000 \
  --destination incident-bucket \
  --destination-prefix security-incident/
```

3. **Check for Persistence**
```bash
# Check for new IAM users/roles
aws iam list-users --query 'Users[?CreateDate > `2024-01-01`]'
aws iam list-roles --query 'Roles[?CreateDate > `2024-01-01`]'

# Check for new access keys
aws iam list-access-keys --user-name admin

# Check EC2 key pairs
aws ec2 describe-key-pairs
```

4. **Analyze CloudTrail**
```bash
# Look for unusual API calls
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=CreateUser \
  --start-time 2024-01-01 \
  --query 'Events[*].[EventTime,Username,EventName,SourceIPAddress]' \
  --output table
```

### Issue: DDoS Attack

**Symptoms**: Very high request rate, legitimate users can't access

**Immediate Mitigation**:

1. **Enable AWS WAF**
```typescript
const waf = new aws.wafv2.WebAcl("emergency-waf", {
    scope: "REGIONAL",
    defaultAction: { allow: {} },
    rules: [{
        name: "RateLimitRule",
        priority: 1,
        statement: {
            rateBasedStatement: {
                limit: 100,  // Requests per 5 minutes
                aggregateKeyType: "IP",
            },
        },
        action: { block: {} },
        visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "RateLimitRule",
        },
    }],
});

// Associate with ALB
new aws.wafv2.WebAclAssociation("waf-alb", {
    resourceArn: alb.arn,
    webAclArn: waf.arn,
});
```

2. **CloudFront Distribution** (for caching and DDoS protection)
```typescript
new aws.cloudfront.Distribution("cdn", {
    origins: [{
        domainName: alb.dnsName,
        originId: "alb",
        customOriginConfig: {
            httpPort: 80,
            httpsPort: 443,
            originProtocolPolicy: "http-only",
        },
    }],
    enabled: true,
    defaultCacheBehavior: {
        targetOriginId: "alb",
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: ["GET", "HEAD", "OPTIONS"],
        cachedMethods: ["GET", "HEAD"],
    },
});
```

---

## Database Issues

### Issue: RDS Storage Full

**Error**: "Could not extend file: No space left on device"

**Immediate Fix**:
```bash
# Modify storage size (can be done online)
aws rds modify-db-instance \
  --db-instance-identifier tinyurl-postgres \
  --allocated-storage 100 \
  --apply-immediately
```

**Long-term Solutions**:

1. **Enable Storage Autoscaling**
```typescript
const dbInstance = new aws.rds.Instance("postgres", {
    allocatedStorage: 20,
    maxAllocatedStorage: 1000,  // Autoscale up to 1TB
});
```

2. **Archive Old Data**
```sql
-- Move old URLs to archive table
INSERT INTO urls_archive 
SELECT * FROM urls 
WHERE created_at < NOW() - INTERVAL '1 year';

DELETE FROM urls 
WHERE created_at < NOW() - INTERVAL '1 year';

-- Reclaim space
VACUUM FULL urls;
```

### Issue: Database Connection Pool Exhausted

**Error**: "remaining connection slots are reserved"

**Diagnosis**:
```sql
-- Check current connections
SELECT count(*) FROM pg_stat_activity;

-- See what's using connections
SELECT pid, usename, application_name, client_addr, state
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY backend_start;

-- Kill long-running queries
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state != 'idle'
  AND query_start < NOW() - INTERVAL '1 hour';
```

**Solutions**:

1. **Increase RDS Connections**
```bash
# Create new parameter group
aws rds create-db-parameter-group \
  --db-parameter-group-name tinyurl-postgres-params \
  --db-parameter-group-family postgres15

# Modify max_connections
aws rds modify-db-parameter-group \
  --db-parameter-group-name tinyurl-postgres-params \
  --parameters "ParameterName=max_connections,ParameterValue=200"

# Apply to instance
aws rds modify-db-instance \
  --db-instance-identifier tinyurl-postgres \
  --db-parameter-group-name tinyurl-postgres-params \
  --apply-immediately
```

2. **Fix Application Pool Settings**
```javascript
const pgPool = new Pool({
    max: 20,                      // Maximum pool size
    idleTimeoutMillis: 30000,     // Close idle connections
    connectionTimeoutMillis: 2000, // Timeout acquiring connection
});

// Add pool error handling
pgPool.on('error', (err) => {
    console.error('Unexpected pool error', err);
});
```

---

## Networking Problems

### Issue: Can't Reach Private Instances

**Symptom**: Session Manager not working

**Diagnosis**:
```bash
# Check instance IAM role
aws ec2 describe-instances \
  --instance-ids i-xxxxx \
  --query 'Reservations[0].Instances[0].IamInstanceProfile'

# Check SSM agent status
aws ssm describe-instance-information \
  --filters "Key=InstanceIds,Values=i-xxxxx"

# Check VPC endpoints (if no NAT Gateway)
aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=vpc-xxxxx"
```

**Solutions**:

1. **Add SSM VPC Endpoints** (for private subnets without NAT)
```typescript
// Required endpoints for Session Manager
const endpoints = [
    'com.amazonaws.region.ssm',
    'com.amazonaws.region.ssmmessages',
    'com.amazonaws.region.ec2messages',
];

endpoints.forEach(service => {
    new aws.ec2.VpcEndpoint(`endpoint-${service}`, {
        vpcId: vpc.vpcId,
        serviceName: service,
        vpcEndpointType: "Interface",
        subnetIds: vpc.privateSubnetIds,
        securityGroupIds: [appSecurityGroup.id],
    });
});
```

2. **Fix IAM Role**
```bash
# Attach SSM policy to role
aws iam attach-role-policy \
  --role-name InstanceRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
```

### Issue: Inter-AZ Latency

**Symptom**: Slow database queries from specific instances

**Diagnosis**:
```bash
# Check instance placement
aws ec2 describe-instances \
  --instance-ids i-xxxxx \
  --query 'Reservations[0].Instances[0].Placement.AvailabilityZone'

# Compare with RDS AZ
aws rds describe-db-instances \
  --db-instance-identifier tinyurl-postgres \
  --query 'DBInstances[0].AvailabilityZone'
```

**Solution**: Use RDS Proxy for connection pooling and routing
```typescript
const dbProxy = new aws.rds.Proxy("db-proxy", {
    engineFamily: "POSTGRESQL",
    auth: [{
        authScheme: "SECRETS",
        secretArn: dbSecret.arn,
    }],
    roleArn: proxyRole.arn,
    vpcSubnetIds: vpc.privateSubnetIds,
    requireTls: true,
});
```

---

## Cost Optimization

### Issue: Unexpectedly High AWS Bill

#### Cost Analysis Process

1. **Identify Top Costs**
```bash
# Use Cost Explorer API
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity DAILY \
  --metrics "UnblendedCost" \
  --group-by Type=DIMENSION,Key=SERVICE
```

2. **Common Cost Issues**:

**Unattached EBS Volumes**
```bash
# Find unattached volumes
aws ec2 describe-volumes \
  --filters "Name=status,Values=available" \
  --query 'Volumes[*].[VolumeId,Size,CreateTime]' \
  --output table

# Delete if not needed
aws ec2 delete-volume --volume-id vol-xxxxx
```

**Unused Elastic IPs**
```bash
# Find unassociated EIPs
aws ec2 describe-addresses \
  --query 'Addresses[?AssociationId==null].[PublicIp,AllocationId]' \
  --output table

# Release if not needed
aws ec2 release-address --allocation-id eipalloc-xxxxx
```

**Oversized Instances**
```bash
# Check CPU utilization
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value=i-xxxxx \
  --statistics Average \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-31T23:59:59Z \
  --period 86400

# If consistently < 20%, consider smaller instance
```

3. **Cost Optimization Strategies**:

**Use Spot Instances for Non-Critical Workloads**
```typescript
const launchTemplate = new aws.ec2.LaunchTemplate("spot-template", {
    instanceMarketOptions: {
        marketType: "spot",
        spotOptions: {
            maxPrice: "0.10",  // Maximum price per hour
            spotInstanceType: "one-time",
        },
    },
});
```

**Reserved Instances for Stable Workloads**
```bash
# Analyze usage for RI recommendations
aws ce get-reservation-purchase-recommendation \
  --service "EC2" \
  --term "ONE_YEAR" \
  --payment-option "PARTIAL_UPFRONT"
```

**Enable S3 Lifecycle Policies**
```typescript
new aws.s3.BucketLifecycleConfiguration("lifecycle", {
    bucket: bucket.id,
    rules: [{
        id: "archive-old-logs",
        status: "Enabled",
        transitions: [{
            days: 30,
            storageClass: "GLACIER",
        }],
        expiration: {
            days: 365,
        },
    }],
});
```

---

## Disaster Recovery

### Issue: Complete Region Failure

#### Recovery Procedure

1. **Assess Damage**
```bash
# Check service health
https://status.aws.amazon.com/

# Try to access resources
aws ec2 describe-instances --region eu-west-1
```

2. **Failover to Backup Region**

**Prerequisites** (should be set up in advance):
```typescript
// Backup stack in different region
const backupStack = new pulumi.StackReference("organization/tinyurl/dr");

// Cross-region replication
const replicationConfig = {
    role: replicationRole.arn,
    rules: [{
        id: "replicate-to-dr",
        status: "Enabled",
        priority: 1,
        destination: {
            bucket: drBucket.arn,
            storageClass: "STANDARD_IA",
        },
    }],
};
```

**Failover Steps**:
```bash
# 1. Update DNS to point to DR region
aws route53 change-resource-record-sets \
  --hosted-zone-id ZXXXXX \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.tinyurl.com",
        "Type": "CNAME",
        "TTL": 60,
        "ResourceRecords": [{"Value": "dr-alb.us-east-1.elb.amazonaws.com"}]
      }
    }]
  }'

# 2. Scale up DR environment
pulumi config set appDesiredCapacity 10 --stack dr
pulumi up --yes --stack dr

# 3. Restore latest database backup
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier tinyurl-postgres-dr \
  --db-snapshot-identifier manual-snapshot-2024-01-15
```

### Issue: Data Corruption

#### PostgreSQL Recovery

1. **Point-in-Time Recovery**
```bash
# Restore to specific time
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier tinyurl-postgres \
  --target-db-instance-identifier tinyurl-postgres-pitr \
  --restore-time 2024-01-15T03:00:00.000Z

# Test recovered data
psql -h tinyurl-postgres-pitr.xxxxx.rds.amazonaws.com \
     -U dbadmin -d tinyurl \
     -c "SELECT COUNT(*) FROM short_codes WHERE created_at > '2024-01-15'"

# Rename instances to switch over
aws rds modify-db-instance \
  --db-instance-identifier tinyurl-postgres \
  --new-db-instance-identifier tinyurl-postgres-old \
  --apply-immediately

aws rds modify-db-instance \
  --db-instance-identifier tinyurl-postgres-pitr \
  --new-db-instance-identifier tinyurl-postgres \
  --apply-immediately
```

2. **Redis Recovery**
```bash
# Restore from snapshot
aws elasticache create-cache-cluster \
  --cache-cluster-id tinyurl-redis-restored \
  --snapshot-name redis-backup-2024-01-15

# Update application configuration
pulumi config set redisEndpoint tinyurl-redis-restored.xxxxx.cache.amazonaws.com
pulumi up --yes
```

3. **CouchDB Recovery**
```bash
# From Docker volume backup
docker run --rm \
  -v /opt/couchdb/data:/data \
  -v /backup:/backup \
  alpine tar xzf /backup/couchdb-backup-2024-01-15.tar.gz -C /data

# Restart CouchDB
docker restart couchdb
```

This comprehensive troubleshooting guide covers every major issue you might encounter with the TinyURL infrastructure, providing detailed diagnosis steps and solutions for each scenario.