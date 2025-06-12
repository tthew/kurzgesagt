# TinyURL - Docker Local Development

This guide explains how to run the TinyURL service locally using Docker Compose.

## Prerequisites

- Docker Desktop installed and running
- Docker Compose (included with Docker Desktop)
- Git

## Quick Start

1. **Clone the repository** (if not already done):
   ```bash
   cd /Users/tthew/Development/tinyurl
   ```

2. **Start all services**:
   ```bash
   docker-compose up -d
   ```

   This will start:
   - PostgreSQL (port 5432)
   - Redis (port 6379)
   - CouchDB (port 5984)
   - Node.js API (port 3000)
   - Nginx load balancer (port 80)

3. **Check service health**:
   ```bash
   # Check if all containers are running
   docker-compose ps

   # Check API health
   curl http://localhost:3333/health
   ```

## API Endpoints

### Create a short URL
```bash
curl -X POST http://localhost:3333/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.example.com"}'
```

### Use a short URL
```bash
# Visit in browser or use curl
curl -L http://localhost:3333/abc123
```

### Get URL statistics
```bash
curl http://localhost:3333/api/stats/abc123
```

### List all URLs
```bash
curl http://localhost:3333/api/urls
```

## Database Access

### PostgreSQL
```bash
# Connect to PostgreSQL
docker exec -it tinyurl-postgres psql -U dbadmin -d tinyurl

# Or use a PostgreSQL client with:
# Host: localhost
# Port: 5432
# Database: tinyurl
# Username: dbadmin
# Password: postgres123
```

### Redis
```bash
# Connect to Redis CLI
docker exec -it tinyurl-redis redis-cli

# Or use a Redis client with:
# Host: localhost
# Port: 6379
```

### CouchDB
```bash
# Access CouchDB web interface
open http://localhost:5984/_utils

# Login with:
# Username: admin
# Password: couchdb123
```

## Development

### View logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f app
```

### Restart a service
```bash
docker-compose restart app
```

### Stop all services
```bash
docker-compose down
```

### Stop and remove all data
```bash
docker-compose down -v
```

### Rebuild after code changes
```bash
docker-compose build app
docker-compose up -d
```

## Development with hot reload

For development with hot reload:

1. Install dependencies locally:
   ```bash
   cd app
   npm install
   ```

2. Run with nodemon:
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
   ```

## Troubleshooting

### Services not starting
```bash
# Check logs
docker-compose logs

# Ensure ports are not in use
lsof -i :80
lsof -i :3000
lsof -i :5432
lsof -i :6379
lsof -i :5984
```

### Database connection issues
- Ensure all services are healthy: `docker-compose ps`
- Check that services can communicate: `docker network ls`
- Verify environment variables in containers: `docker-compose exec app env`

### Reset everything
```bash
# Stop all containers and remove volumes
docker-compose down -v

# Remove all Docker data (careful!)
docker system prune -a --volumes
```

## Architecture

The Docker setup mirrors the AWS infrastructure:
- **Nginx**: Acts as the load balancer (like ALB)
- **Node.js App**: The application server (like EC2 instances)
- **PostgreSQL**: Main database (like RDS)
- **Redis**: Caching layer (like ElastiCache)
- **CouchDB**: Document store for analytics

All services run in an isolated Docker network and can communicate using service names as hostnames.