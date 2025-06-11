output "endpoint" {
  description = "Redis endpoint"
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
}

output "port" {
  description = "Redis port"
  value       = aws_elasticache_cluster.redis.port
}

output "cluster_id" {
  description = "ID of the Redis cluster"
  value       = aws_elasticache_cluster.redis.id
}