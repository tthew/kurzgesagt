output "endpoint" {
  description = "CouchDB endpoint"
  value       = "http://${aws_instance.couchdb.private_ip}:5984"
}

output "instance_id" {
  description = "ID of the CouchDB instance"
  value       = aws_instance.couchdb.id
}

output "private_ip" {
  description = "Private IP of CouchDB instance"
  value       = aws_instance.couchdb.private_ip
}