const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const nano = require('nano');
const { nanoid } = require('nanoid');
const helmet = require('helmet');
const cors = require('cors');

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// PostgreSQL connection pool
const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'tinyurl',
  user: process.env.POSTGRES_USER || 'dbadmin',
  password: process.env.POSTGRES_PASSWORD || 'postgres123',
});

// Redis client
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  }
});

// CouchDB connection
const couchdbUrl = `http://${process.env.COUCHDB_USER}:${process.env.COUCHDB_PASSWORD}@${process.env.COUCHDB_HOST}:${process.env.COUCHDB_PORT}`;
const couchdb = nano(couchdbUrl);

// Initialize connections
async function initializeConnections() {
  try {
    // Connect to Redis
    await redisClient.connect();
    console.log('Connected to Redis');

    // Test PostgreSQL connection
    await pgPool.query('SELECT NOW()');
    console.log('Connected to PostgreSQL');

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS short_codes (
        short_code VARCHAR(10) UNIQUE NOT NULL PRIMARY KEY,
        used BOOLEAN DEFAULT FALSE
      )
    `);

    await pgPool.query(`
      CREATE INDEX IF NOT EXISTS idx_short_code ON short_codes(short_code)
    `);

    const result = await pgPool.query('SELECT COUNT(*) FROM short_codes');

    if (parseInt(result.rows[0].count, 10) < 1000) {
      console.log('Seeding short codes...');

      const seedCount = 1000;
      const seedValues = Array.from({ length: seedCount }, (_, i) => `('${nanoid(8)}', false)`).join(',');

      await pgPool.query(`
        INSERT INTO short_codes (short_code, used)
        VALUES ${seedValues}
        ON CONFLICT (short_code) DO NOTHING
      `);
    } else {
      console.log('Plenty of short codes available, skipping seed.'); 
    }

    // Initialize CouchDB database
    try {
      await couchdb.db.create('tiny_urls');
      await couchdb.use('tiny_urls').createIndex({
        index: { fields: ['shortCode', 'created_at', 'long_url'] },
        name: 'short_code_created_at_index',
      });

      await couchdb.use('tiny_urls').createIndex({
        index: { fields: ['created_at'] },
        name: 'created_at_index',
      }); 

      await couchdb.use('tiny_urls').createIndex({
        index: { fields: ['long_url'] },
        name: 'long_url_index',
      });
    } catch (err) {
      if (err.statusCode !== 412) { // 412 means database already exists
        console.error('Error creating CouchDB database:', err);
      }
    }
    console.log('Connected to CouchDB');

  } catch (err) {
    console.error('Connection error:', err);
    process.exit(1);
  }
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      postgres: false,
      redis: false,
      couchdb: false
    }
  };

  try {
    await pgPool.query('SELECT 1');
    health.services.postgres = true;
  } catch (err) {
    health.status = 'unhealthy';
  }

  try {
    await redisClient.ping();
    health.services.redis = true;
  } catch (err) {
    health.status = 'unhealthy';
  }

  try {
    await couchdb.db.list();
    health.services.couchdb = true;
  } catch (err) {
    health.status = 'unhealthy';
  }

  res.status(health.status === 'healthy' ? 200 : 503).json(health);
});

// Create short URL
app.post('/api/shorten', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // Seelect a short code from PostgreSQL
    let shortCode;

    try {
      await pgPool.query('BEGIN'); 

      const shortCodeResult = await pgPool.query(
        'SELECT short_code FROM short_codes WHERE used = false LIMIT 1'
      );

      await pgPool.query('UPDATE short_codes SET used = true WHERE short_code = $1', [shortCodeResult.rows[0].short_code]);

      await pgPool.query('COMMIT');

      if (shortCodeResult.rows.length === 0) {
        return res.status(500).json({ error: 'No available short codes' });
      }

      shortCode = shortCodeResult.rows[0].short_code;
      
    } catch (err) {
      await pgPool.query('ROLLBACK');

      console.error('Error generating short code:', err);
      return res.status(500).json({ error: 'Failed to generate short code' });
    }

    // Cache in Redis with TTL of 1 hour
    await redisClient.setEx(`url:${shortCode}`, 3600, url);

    // Store urls in CouchDB
    const urls = couchdb.use('tiny_urls');
    await urls.insert({
      shortCode: shortCode,
      created_at: new Date().toISOString(),
      long_url: url,
      ip: req.ip
    });

    res.json({
      shortUrl: `http://localhost/${shortCode}`,
      shortCode,
      longUrl: url
    });
  } catch (err) {
    console.error('Error creating short URL:', err);
    res.status(500).json({ error: 'Failed to create short URL' });
  }
});

// Redirect to long URL
app.get('/:shortCode', async (req, res) => {
  const { shortCode } = req.params;

  try {
    // Check Redis cache first
    const cachedUrl = await redisClient.get(`url:${shortCode}`);
    
    if (cachedUrl) {
      return res.redirect(cachedUrl);
    }

    // If not in cache, check CouchDB
    const result = await couchdb.use('tiny_urls').find({
      selector: { shortCode: shortCode },
      fields: ['long_url'],
    });

    if (result.docs.length === 0) {
      return res.status(404).json({ error: 'Short URL not found' });
    }

    const longUrl = result.docs[0].long_url;
    
    // Update cache
    await redisClient.setEx(`url:${shortCode}`, 3600, longUrl);

    res.redirect(longUrl);
  } catch (err) {
    console.error('Error redirecting:', err);
    res.status(500).json({ error: 'Failed to redirect' });
  }
});

// List all URLs
app.get('/api/urls', async (req, res) => {
  try {
    const result = await couchdb.use('tiny_urls').list({include_docs: true})
  
    // console.log('Result:', result);
    res.json(result.rows.map(({doc}) => ({
      shortCode: doc.shortCode,
      longUrl: doc.long_url,
    })));

  } catch (err) {
    console.error('Error listing URLs:', err);
    res.status(500).json({ error: 'Failed to list URLs' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;

initializeConnections().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});