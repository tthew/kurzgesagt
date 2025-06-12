# TinyURL Service

A complete URL shortening service with infrastructure as code and local development support.

## Features

- **URL Shortening**: Create short URLs with custom codes
- **Analytics**: Track clicks and usage statistics
- **Multi-Database**: PostgreSQL, Redis, and CouchDB integration
- **Auto-Scaling**: Horizontal scaling with load balancing
- **Infrastructure as Code**: Pulumi for AWS deployment
- **Local Development**: Docker Compose for local testing

## Quick Start - Local Development

Run the entire stack locally with Docker:

```bash
docker-compose up -d
```

Access the API at http://localhost:3333 and create short URLs:

```bash
curl -X POST http://localhost:3333/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.example.com"}'
```

See [README-DOCKER.md](README-DOCKER.md) for detailed local development instructions.

## AWS Deployment with Pulumi

Deploy to AWS using Pulumi infrastructure as code:

```bash
cd pulumi
npm install
pulumi config set --secret tinyurl:postgresPassword your-password
pulumi up
```

See [pulumi/README.md](pulumi/README.md) for detailed deployment instructions.

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

## Project Structure

```
├── app/                    # Node.js application code
├── docker-compose.yml      # Local development stack
├── nginx/                  # Load balancer configuration
├── pulumi/                 # AWS infrastructure as code
│   ├── components/         # Reusable Pulumi components
│   └── README.md          # Deployment instructions
├── README-DOCKER.md       # Local development guide
└── README.md              # This file
```

## API Endpoints

- `POST /api/shorten` - Create a short URL
- `GET /:shortCode` - Redirect to original URL
- `GET /api/urls` - List all URLs
- `GET /health` - Health check endpoint

## Technology Stack

- **Backend**: Node.js with Express
- **Databases**: PostgreSQL, Redis, CouchDB
- **Infrastructure**: Pulumi (TypeScript)
- **Containerization**: Docker & Docker Compose
- **Load Balancing**: Nginx (local), AWS ALB (production)
- **Cloud**: AWS (EC2, RDS, ElastiCache)

## Cost Estimation

This setup includes:
- 1 CouchDB EC2 instance (t3.medium)
- 1 RDS PostgreSQL instance (db.t3.micro)
- 1 ElastiCache Redis node (cache.t3.micro)
- 2+ App server EC2 instances (t3.small)
- 1 Application Load Balancer

Estimated monthly cost: ~$150-200 (varies by region and usage)