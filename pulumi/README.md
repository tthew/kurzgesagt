# TinyURL Infrastructure - Pulumi

This directory contains the Pulumi infrastructure code for the TinyURL service, refactored from Terraform.

## Prerequisites

1. Install Pulumi CLI: https://www.pulumi.com/docs/get-started/install/
2. Install Node.js and npm
3. Configure AWS credentials
4. Have an AWS account with appropriate permissions

## Setup

1. Install dependencies:
   ```bash
   cd pulumi
   npm install
   ```

2. Login to Pulumi:
   ```bash
   pulumi login
   ```

3. Initialize a new stack (if needed):
   ```bash
   pulumi stack init dev
   ```

## Configuration

Set the required configuration values:

```bash
# Set PostgreSQL password
pulumi config set --secret tinyurl:postgresPassword your-secure-password-here

# Optional: Override default settings
pulumi config set tinyurl:projectName myapp
pulumi config set tinyurl:environment staging
```

## Deployment

1. Preview the changes:
   ```bash
   pulumi preview
   ```

2. Deploy the infrastructure:
   ```bash
   pulumi up
   ```

3. View the outputs:
   ```bash
   pulumi stack output
   ```

## Stack Management

### Create different environments:

```bash
# Development
pulumi stack init dev
pulumi config set --secret tinyurl:postgresPassword dev-password

# Production
pulumi stack init prod
pulumi config set --secret tinyurl:postgresPassword prod-password
```

### Switch between stacks:

```bash
pulumi stack select dev
pulumi stack select prod
```

## Architecture

The Pulumi code creates the same infrastructure as the Terraform version:

- **VPC**: Custom VPC with public and private subnets
- **CouchDB**: EC2 instance with CouchDB
- **PostgreSQL**: RDS instance
- **Redis**: ElastiCache cluster
- **App Servers**: Auto-scaling group with Node.js
- **Load Balancer**: Application Load Balancer

## Component Structure

- `components/couchdb.ts`: CouchDB EC2 instance
- `components/postgresql.ts`: RDS PostgreSQL instance
- `components/redis.ts`: ElastiCache Redis cluster
- `components/appserver.ts`: Auto-scaling group for Node.js apps
- `components/loadbalancer.ts`: Application Load Balancer

## Configuration Options

All configuration is in `Pulumi.<stack>.yaml`:

- `projectName`: Name prefix for resources
- `environment`: Environment tag
- `vpcCidr`: VPC CIDR block
- `availabilityZones`: List of AZs to use
- `couchdbInstanceType`: EC2 instance type for CouchDB
- `postgresInstanceClass`: RDS instance class
- `postgresStorageSize`: Storage size in GB
- `redisNodeType`: ElastiCache node type
- `appInstanceType`: EC2 instance type for app servers
- Auto-scaling parameters for app servers

## Secrets Management

Sensitive values are stored as Pulumi secrets:

```bash
pulumi config set --secret tinyurl:postgresPassword your-password
```

## Clean Up

To destroy all resources:

```bash
pulumi destroy
```