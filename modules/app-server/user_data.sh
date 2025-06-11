#!/bin/bash
set -e

# Update system
yum update -y

# Install Node.js 18
curl -sL https://rpm.nodesource.com/setup_18.x | bash -
yum install -y nodejs

# Install git and other dependencies
yum install -y git

# Create app directory
mkdir -p /opt/app
cd /opt/app

# Create a simple Node.js application
cat > package.json <<EOF
{
  "name": "${project_name}-api",
  "version": "1.0.0",
  "description": "API server for ${project_name}",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.3",
    "redis": "^4.6.7",
    "nano": "^10.1.2"
  }
}
EOF

# Create the server file
cat > server.js <<'EOF'
const express = require('express');
const { Client } = require('pg');
const redis = require('redis');
const nano = require('nano');

const app = express();
app.use(express.json());

// PostgreSQL connection
const pgClient = new Client({
  connectionString: 'postgres://${postgres_username}:${postgres_password}@${postgres_endpoint}/${postgres_db_name}'
});

// Redis connection
const redisClient = redis.createClient({
  socket: {
    host: '${redis_endpoint}',
    port: 6379
  }
});

// CouchDB connection
const couchdb = nano('${couchdb_endpoint}');

// Connect to databases
async function connectDatabases() {
  try {
    await pgClient.connect();
    console.log('Connected to PostgreSQL');
    
    await redisClient.connect();
    console.log('Connected to Redis');
    
    console.log('CouchDB endpoint configured');
  } catch (err) {
    console.error('Database connection error:', err);
  }
}

connectDatabases();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Basic API endpoints
app.get('/', (req, res) => {
  res.json({ 
    message: 'Welcome to ${project_name} API',
    environment: '${environment}'
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
EOF

# Install dependencies
npm install

# Create systemd service
cat > /etc/systemd/system/nodeapp.service <<EOF
[Unit]
Description=Node.js Application
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/app
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=nodeapp
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Start and enable the service
systemctl daemon-reload
systemctl enable nodeapp
systemctl start nodeapp