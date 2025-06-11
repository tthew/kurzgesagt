terraform {
  required_version = ">= 1.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# VPC and Networking
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "${var.project_name}-vpc"
    Environment = var.environment
  }
}

resource "aws_subnet" "public" {
  count                   = length(var.availability_zones)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name        = "${var.project_name}-public-subnet-${count.index + 1}"
    Environment = var.environment
  }
}

resource "aws_subnet" "private" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name        = "${var.project_name}-private-subnet-${count.index + 1}"
    Environment = var.environment
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name        = "${var.project_name}-igw"
    Environment = var.environment
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name        = "${var.project_name}-public-rt"
    Environment = var.environment
  }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Security Groups
resource "aws_security_group" "app" {
  name        = "${var.project_name}-app-sg"
  description = "Security group for application servers"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-app-sg"
    Environment = var.environment
  }
}

resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb-sg"
  description = "Security group for Application Load Balancer"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-alb-sg"
    Environment = var.environment
  }
}

resource "aws_security_group" "database" {
  name        = "${var.project_name}-database-sg"
  description = "Security group for databases"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name        = "${var.project_name}-database-sg"
    Environment = var.environment
  }
}

# Database security group rules
resource "aws_security_group_rule" "postgres_ingress" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.app.id
  security_group_id        = aws_security_group.database.id
}

resource "aws_security_group_rule" "redis_ingress" {
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.app.id
  security_group_id        = aws_security_group.database.id
}

resource "aws_security_group_rule" "couchdb_ingress" {
  type                     = "ingress"
  from_port                = 5984
  to_port                  = 5984
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.app.id
  security_group_id        = aws_security_group.database.id
}

resource "aws_security_group_rule" "database_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.database.id
}

# Module calls
module "couchdb" {
  source = "./modules/couchdb"

  project_name      = var.project_name
  environment       = var.environment
  vpc_id            = aws_vpc.main.id
  subnet_ids        = aws_subnet.private[*].id
  security_group_id = aws_security_group.database.id
  instance_type     = var.couchdb_instance_type
}

module "postgres" {
  source = "./modules/postgres"

  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = aws_vpc.main.id
  subnet_ids         = aws_subnet.private[*].id
  security_group_ids = [aws_security_group.database.id]
  instance_class     = var.postgres_instance_class
  allocated_storage  = var.postgres_storage_size
  db_name            = var.postgres_db_name
  username           = var.postgres_username
  password           = var.postgres_password
}

module "redis" {
  source = "./modules/redis"

  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = aws_vpc.main.id
  subnet_ids         = aws_subnet.private[*].id
  security_group_ids = [aws_security_group.database.id]
  node_type          = var.redis_node_type
}

module "app_server" {
  source = "./modules/app-server"

  project_name      = var.project_name
  environment       = var.environment
  vpc_id            = aws_vpc.main.id
  subnet_ids        = aws_subnet.private[*].id
  security_group_id = aws_security_group.app.id
  instance_type     = var.app_instance_type
  desired_capacity  = var.app_desired_capacity
  min_size          = var.app_min_size
  max_size          = var.app_max_size
  
  # Database endpoints
  postgres_endpoint = module.postgres.endpoint
  redis_endpoint    = module.redis.endpoint
  couchdb_endpoint  = module.couchdb.endpoint
  
  # Database credentials
  postgres_username = var.postgres_username
  postgres_password = var.postgres_password
  postgres_db_name  = var.postgres_db_name
}

module "load_balancer" {
  source = "./modules/load-balancer"

  project_name      = var.project_name
  environment       = var.environment
  vpc_id            = aws_vpc.main.id
  subnet_ids        = aws_subnet.public[*].id
  security_group_id = aws_security_group.alb.id
  target_group_arn  = module.app_server.target_group_arn
}