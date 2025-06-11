#!/bin/bash
set -e

# Update system
apt-get update
apt-get upgrade -y

# Install dependencies
apt-get install -y curl apt-transport-https gnupg

# Add CouchDB repository
echo "deb https://apache.jfrog.io/artifactory/couchdb-deb/ jammy main" | tee /etc/apt/sources.list.d/couchdb.list
curl -L https://couchdb.apache.org/repo/keys.asc | apt-key add -

# Install CouchDB
DEBIAN_FRONTEND=noninteractive apt-get install -y couchdb

# Configure CouchDB
cat > /opt/couchdb/etc/local.ini <<EOF
[couchdb]
single_node=true

[chttpd]
bind_address = 0.0.0.0

[admins]
admin = ${couchdb_admin_password}
EOF

# Start and enable CouchDB
systemctl stop couchdb
systemctl start couchdb
systemctl enable couchdb

# Wait for CouchDB to start
sleep 10

# Initialize system databases
curl -X PUT http://admin:${couchdb_admin_password}@localhost:5984/_users
curl -X PUT http://admin:${couchdb_admin_password}@localhost:5984/_replicator
curl -X PUT http://admin:${couchdb_admin_password}@localhost:5984/_global_changes