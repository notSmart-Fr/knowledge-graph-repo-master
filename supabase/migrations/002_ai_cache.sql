
-- 002_ai_cache.sql
-- Task 3.2: AI Cache Tables

CREATE SCHEMA IF NOT EXISTS ai_cache;

-- Enable pgvector extension (required for vector similarity search in cache)
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ponytail: extensions.vector because pgvector's type lives in the extensions schema on Supabase Cloud
CREATE TABLE IF NOT EXISTS ai_cache.cache_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    embedding extensions.vector(768),
    prompt_hash TEXT,
    response JSONB,
    intent_tags JSONB DEFAULT '[]',
    model TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    accessed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create ivfflat index for vector similarity
CREATE INDEX IF NOT EXISTS cache_embeddings_idx ON ai_cache.cache_embeddings
USING ivfflat (embedding extensions.vector_cosine_ops)
WITH (lists = 100);
