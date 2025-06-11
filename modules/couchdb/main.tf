data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_instance" "couchdb" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_ids[0]
  vpc_security_group_ids = [var.security_group_id]

  user_data = base64encode(templatefile("${path.module}/user_data.sh", {
    couchdb_admin_password = random_password.couchdb_admin.result
  }))

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name        = "${var.project_name}-couchdb"
    Environment = var.environment
  }
}

resource "random_password" "couchdb_admin" {
  length  = 32
  special = true
}

resource "aws_ssm_parameter" "couchdb_admin_password" {
  name  = "/${var.project_name}/${var.environment}/couchdb/admin_password"
  type  = "SecureString"
  value = random_password.couchdb_admin.result

  tags = {
    Environment = var.environment
  }
}