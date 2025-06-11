variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "tinyurl"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

# CouchDB variables
variable "couchdb_instance_type" {
  description = "Instance type for CouchDB"
  type        = string
  default     = "t3.medium"
}

# PostgreSQL variables
variable "postgres_instance_class" {
  description = "Instance class for PostgreSQL"
  type        = string
  default     = "db.t3.micro"
}

variable "postgres_storage_size" {
  description = "Allocated storage for PostgreSQL in GB"
  type        = number
  default     = 20
}

variable "postgres_db_name" {
  description = "Name of the PostgreSQL database"
  type        = string
  default     = "tinyurl"
}

variable "postgres_username" {
  description = "Master username for PostgreSQL"
  type        = string
  default     = "dbadmin"
}

variable "postgres_password" {
  description = "Master password for PostgreSQL"
  type        = string
  sensitive   = true
}

# Redis variables
variable "redis_node_type" {
  description = "Node type for Redis"
  type        = string
  default     = "cache.t3.micro"
}

# App server variables
variable "app_instance_type" {
  description = "Instance type for application servers"
  type        = string
  default     = "t3.small"
}

variable "app_desired_capacity" {
  description = "Desired number of application instances"
  type        = number
  default     = 2
}

variable "app_min_size" {
  description = "Minimum number of application instances"
  type        = number
  default     = 1
}

variable "app_max_size" {
  description = "Maximum number of application instances"
  type        = number
  default     = 4
}