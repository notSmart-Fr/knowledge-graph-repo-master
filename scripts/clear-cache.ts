import pg from 'pg';
import path from 'path';
import fs from 'fs';

const { Pool } = pg;

// Load .env
try {
  const envPath = path.resolve(process.cwd(), 'apps/storefront/.env');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    for (const line of envConfig.split(/\r?\n/)) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1);
        } else if (val.startsWith("'") && val.endsWith("'")) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val.trim();
      }
    }
  }
} catch (e) {
  console.error(e);
}

const pool = new Pool({
  connectionString: process.env.PAYLOAD_DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function clear() {
  const client = await pool.connect();
  try {
    console.log('Flushing all entries from semantic cache...');
    const res = await client.query(
      "DELETE FROM ai_cache.cache_embeddings"
    );
    console.log(`Successfully flushed semantic cache (${res.rowCount} row(s) deleted).`);
  } catch (error) {
    console.error('Failed to clear cache:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

clear();
