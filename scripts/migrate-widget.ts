/**
 * Widget schema migration — applies 006_widget_sessions.sql changes.
 *
 * ponytail: Supabase JS has no DDL API. Run `supabase db push` or apply
 * supabase/migrations/006_widget_sessions.sql in the dashboard, then run:
 *   npx tsx scripts/migrate-widget.ts
 *
 * This script probes that live_room_name is queryable (post-migration validation).
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createLogger } from "../packages/ai-core/src/core/logger.js";

const logger = createLogger("migrate-widget");

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(__dirname, "../supabase/migrations/006_widget_sessions.sql");

export const WIDGET_MIGRATION_SQL = readFileSync(MIGRATION_PATH, "utf8");

export async function probeWidgetSchema(): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    logger.error("SUPABASE_URL and SUPABASE_SECRET_KEY required for probe");
    return false;
  }

  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.from("user_sessions").select("id, channel, live_room_name").limit(1);
  if (error) {
    logger.error("Schema probe failed — apply migration first", { error: error.message });
    return false;
  }
  logger.info("Widget schema probe passed (live_room_name column present)");
  return true;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("migrate-widget.ts")) {
  logger.info("Widget migration SQL location", { path: MIGRATION_PATH });
  logger.info("Apply via: supabase db push  OR  paste SQL from 006_widget_sessions.sql");
  const ok = await probeWidgetSchema();
  process.exit(ok ? 0 : 1);
}
