# TinyURL Infrastructure

This Terraform project sets up a complete infrastructure for a TinyURL service with:
- CouchDB (NoSQL database)
- PostgreSQL (Relational database)
- Redis (Caching layer)
- Node.js Application Servers (Auto-scaling group)
- Application Load Balancer

## Prerequisites

1. Install Terraform (>= 1.0)
2. Configure AWS credentials
3. Have an AWS account with appropriate permissions

## Usage

1. Clone this repository
2. Copy `terraform.tfvars.example` to `terraform.tfvars`:
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

3. Edit `terraform.tfvars` and set your PostgreSQL password:
   ```hcl
   postgres_password = "your-secure-password-here"
   ```

4. Initialize Terraform:
   ```bash
   terraform init
   ```

5. Review the plan:
   ```bash
   terraform plan
   ```

6. Apply the configuration:
   ```bash
   terraform apply
   ```

## Architecture

The infrastructure includes:

- **VPC**: Custom VPC with public and private subnets across multiple AZs
- **CouchDB**: EC2 instance running CouchDB for document storage
- **PostgreSQL**: RDS instance for relational data
- **Redis**: ElastiCache cluster for caching
- **App Servers**: Auto-scaling group of EC2 instances running Node.js
- **Load Balancer**: Application Load Balancer distributing traffic

## Outputs

After applying, you'll get:
- `load_balancer_dns`: The DNS name to access your application
- `postgres_endpoint`: PostgreSQL connection endpoint
- `redis_endpoint`: Redis connection endpoint
- `couchdb_endpoint`: CouchDB connection endpoint

## Customization

You can customize the deployment by modifying variables in `terraform.tfvars`:
- Instance types for each service
- Auto-scaling parameters
- VPC CIDR blocks
- AWS region

## Security Notes

- All databases are in private subnets
- Security groups restrict access appropriately
- Passwords are stored in AWS Systems Manager Parameter Store
- Enable encryption at rest for all data stores

## Clean Up

To destroy all resources:
```bash
terraform destroy
```

## Cost Estimation

This setup includes:
- 1 CouchDB EC2 instance (t3.medium)
- 1 RDS PostgreSQL instance (db.t3.micro)
- 1 ElastiCache Redis node (cache.t3.micro)
- 2+ App server EC2 instances (t3.small)
- 1 Application Load Balancer

Estimated monthly cost: ~$150-200 (varies by region and usage)