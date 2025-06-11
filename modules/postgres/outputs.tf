output "endpoint" {
  description = "PostgreSQL endpoint"
  value       = aws_db_instance.postgres.endpoint
}

output "address" {
  description = "PostgreSQL address"
  value       = aws_db_instance.postgres.address
}

output "port" {
  description = "PostgreSQL port"
  value       = aws_db_instance.postgres.port
}

output "database_name" {
  description = "Name of the database"
  value       = aws_db_instance.postgres.db_name
}