output "load_balancer_dns" {
  description = "DNS name of the load balancer"
  value       = module.load_balancer.dns_name
}

output "postgres_endpoint" {
  description = "PostgreSQL endpoint"
  value       = module.postgres.endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "Redis endpoint"
  value       = module.redis.endpoint
  sensitive   = true
}

output "couchdb_endpoint" {
  description = "CouchDB endpoint"
  value       = module.couchdb.endpoint
  sensitive   = true
}

output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "app_server_asg_name" {
  description = "Name of the application server Auto Scaling Group"
  value       = module.app_server.asg_name
}