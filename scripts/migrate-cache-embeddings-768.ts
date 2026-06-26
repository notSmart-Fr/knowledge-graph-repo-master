import pg from 'pg';
import path from 'path';
import fs from 'fs';

const { Pool } = pg;

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
  console.error('Failed to load .env file:', e);
  process.exit(1);
}

const dbUrl = process.env.PAYLOAD_DATABASE_URL;
if (!dbUrl) {
  console.error('PAYLOAD_DATABASE_URL is not set in apps/storefront/.env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

const migrationStatements = [
  'TRUNCATE ai_cache.cache_embeddings',
  'ALTER TABLE ai_cache.cache_embeddings ALTER COLUMN embedding TYPE vector(768)',
  'DROP INDEX IF EXISTS ai_cache.idx_cache_embeddings_vector',
  `CREATE INDEX idx_cache_embeddings_vector
   ON ai_cache.cache_embeddings
   USING hnsw (embedding vector_cosine_ops)`,
];

async function runMigration() {
  const client = await pool.connect();
  try {
    for (const sql of migrationStatements) {
      console.log(`Running: ${sql.split('\n')[0]}...`);
      await client.query(sql);
    }
    console.log('--- CACHE EMBEDDING MIGRATION SUCCESSFUL (vector 768 / gemini-embedding-2) ---');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
