import { z } from "zod";

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
  GEMINI_API_KEY: z.string().startsWith("AIza"),
  DEEPSEEK_API_KEY: z.string().startsWith("sk-"),
  LOCAL_LLM_URL: z.string().url().default("http://localhost:11434").optional(),
  // Voice
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(3),
  LIVEKIT_SECRET: z.string().min(3),
  CARTESIA_API_KEY: z.string().startsWith("sk-"),
  // WhatsApp
  WHATSAPP_API_TOKEN: z.string().min(10),
  WHATSAPP_PHONE_ID: z.string().min(10),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(5),
  WHATSAPP_API_VERSION: z.string().default("v20.0"),
  WHATSAPP_WEBHOOK_URL: z.string().url().optional(),
  APP_PORT: z.coerce.number().default(3000),
  // Telemetry
  OTEL_SERVICE_NAME: z.string().default("ai-crm"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  // Redis
  REDIS_URL: z.string().url(),
  // Encryption
  ENCRYPTION_MASTER_KEY: z.string().length(64), // 32-byte hex key
});

// Parse and validate environment variables on import
export const env = envSchema.parse(process.env);
