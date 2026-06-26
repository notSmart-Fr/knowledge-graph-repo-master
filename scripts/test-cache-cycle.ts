import fs from 'fs';
import path from 'path';

// Load .env manually to avoid dotenv dependency issues in standalone script
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
  console.warn('Failed to load .env file:', e);
}

async function runTest() {
  // Dynamically import the cache engine after env variables are loaded to avoid ESM static hoisting issues
  // @ts-ignore
  const { getSemanticCache, setSemanticCache, getEmbedding } = await import(
    "@dtc/ai-core/cache-engine"
  );

  const queryText = 'How can I contact customer support?';
  console.log(`[1] Running first cache lookup for query: "${queryText}"`);
  
  const firstLookup = await getSemanticCache(queryText);
  console.log(`First lookup result (Expected: null):`, firstLookup);
  
  if (firstLookup !== null) {
    throw new Error('Expected first lookup to return null (CACHE MISS) on clean DB!');
  }
  
  console.log(`[2] Generating embedding via gemini-embedding-2...`);
  const embedding = await getEmbedding(queryText);
  console.log(`Successfully generated embedding (${embedding.length} dimensions)`);
  
  const mockResponse = { response: 'You can contact support at support@storefront.com' };
  console.log(`[3] Storing response in semantic cache...`);
  await setSemanticCache(queryText, embedding, mockResponse);
  console.log('Successfully stored in cache.');
  
  console.log(`[4] Running second cache lookup for query: "${queryText}"`);
  const secondLookup = await getSemanticCache(queryText);
  console.log(`Second lookup result (Expected: mock response):`, secondLookup);
  
  if (!secondLookup || (secondLookup as { response: string }).response !== mockResponse.response) {
    throw new Error('Expected cache hit, but got unexpected or null result.');
  }
  
  console.log('--- TEST CYCLE SUCCESSFUL ---');
}

runTest().catch((err) => {
  console.error('Test cycle failed:', err);
  process.exit(1);
});

