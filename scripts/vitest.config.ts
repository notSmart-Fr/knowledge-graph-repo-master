import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "x".repeat(10),
      SUPABASE_SECRET_KEY: "x".repeat(10),
      NEO4J_URI: "bolt://localhost:7687",
      NEO4J_USER: "neo4j",
      NEO4J_PASSWORD: "password",
      GEMINI_API_KEY: "AIza" + "x".repeat(35),
      DEEPSEEK_API_KEY: "sk-" + "x".repeat(20),
      LOCAL_LLM_URL: "http://localhost:11434",
      LIVEKIT_URL: "https://livekit.example.com",
      LIVEKIT_API_KEY: "x".repeat(10),
      LIVEKIT_SECRET: "x".repeat(10),
      CARTESIA_API_KEY: "sk-" + "x".repeat(20),
      WHATSAPP_API_TOKEN: "x".repeat(10),
      WHATSAPP_PHONE_ID: "x".repeat(10),
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "x".repeat(10),
      WHATSAPP_API_VERSION: "v20.0",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com",
      REDIS_URL: "redis://localhost:6379",
      ENCRYPTION_MASTER_KEY: "a".repeat(64),
    },
  },
});
