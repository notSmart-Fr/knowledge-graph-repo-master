import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Try to load .env from process.cwd() into process.env.
 * ponytail: minimal inline parser — no dotenv dependency needed.
 * Called once on first getEnv() access, before Zod parse.
 */
function tryLoadDotEnv(): void {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)?$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let val = match[2] ?? "";
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val.trim();
  }
}

export const envSchema = z.object({
  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  SUPABASE_SECRET_KEY: z.string().min(10),
  // Neo4j
  NEO4J_URI: z.string().url(),
  NEO4J_USER: z.string().min(1),
  NEO4J_PASSWORD: z.string().min(1),
  // AI
  GEMINI_API_KEY: z.string().startsWith("AIza").optional(),
  GEMINI_API_URL: z.string().url().default("https://generativelanguage.googleapis.com"),
  DEEPSEEK_API_KEY: z.string().startsWith("sk-").optional(),
  DEEPSEEK_API_URL: z.string().url().default("https://api.deepseek.com/chat/completions"),
  LOCAL_LLM_URL: z.string().url().default("http://localhost:11434").optional(),
  // Ollama
  OLLAMA_EMBED_MODEL: z.string().default("nomic-embed-text"),
  // Voice (optional — required only for voice/WhatsApp channels)
  LIVEKIT_URL: z.string().url().optional().default("wss://localhost:7880"),
  LIVEKIT_API_KEY: z.string().min(3).optional().default("dev-key"),
  LIVEKIT_SECRET: z.string().min(3).optional().default("dev-secret"),
  LIVEKIT_WEBHOOK_SECRET: z.string().min(3).optional(),
  // ponytail: no startsWith("sk-") — Cartesia keys don't always follow this pattern
  CARTESIA_API_KEY: z.string().min(1).optional(),
  // Widget server (002-chat-widget)
  WIDGET_SERVER_PORT: z.coerce.number().default(8290),
  WIDGET_ALLOWED_ORIGINS: z.string().optional(),
  // WhatsApp (optional — required only for WhatsApp channel)
  WHATSAPP_API_TOKEN: z.string().min(10).optional().default("dev-whatsapp-token-placeholder"),
  WHATSAPP_PHONE_ID: z.string().min(10).optional().default("000000000000000"),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(5).optional().default("dev-verify-token"),
  WHATSAPP_API_VERSION: z.string().default("v20.0"),
  WHATSAPP_WEBHOOK_URL: z.string().url().optional(),
  APP_PORT: z.coerce.number().default(3000),
  // Telemetry (optional — local dev doesn't need Grafana Cloud)
  OTEL_SERVICE_NAME: z.string().default("ai-crm"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional().default("http://localhost:4318"),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  // Redis (optional — falls back to Supabase for idempotency, in-memory for DLQ)
  REDIS_URL: z.string().url().optional(),
  // Encryption
  ENCRYPTION_MASTER_KEY: z.string().length(64), // 32-byte hex key
  // DSAR
  DSAR_ENABLED: z.coerce.boolean().default(false),
});

// Lazy env singleton — parse runs on first access, not at import time.
// This lets tests import modules without setting dummy env vars.
let _env: z.infer<typeof envSchema> | null = null;

export function getEnv(): z.infer<typeof envSchema> {
  if (!_env) {
    tryLoadDotEnv();
    _env = envSchema.parse(process.env);
  }
  return _env;
}

// Backward-compatible alias for existing call sites that use `import { env }`.
// ponytail: lazy singleton via getter; the parse runs on first property access
// instead of module load, so importing ai-core modules doesn't crash when
// env vars aren't set (e.g. during unit tests).
export const env = new Proxy({} as z.infer<typeof envSchema>, {
  get(_target, prop: string | symbol) {
    return getEnv()[prop as keyof z.infer<typeof envSchema>];
  },
  has(_target, prop: string | symbol) {
    return prop in getEnv();
  },
  ownKeys() {
    return Reflect.ownKeys(getEnv());
  },
  getOwnPropertyDescriptor() {
    return {
      enumerable: true,
      configurable: true,
    };
  },
});
