// Loads .env from repo root for scripts (Node-compatible).
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function applyEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;

  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)?$/);
    if (!match) continue;

    const key = match[1];
    if (process.env[key] !== undefined) continue;

    let val = match[2] ?? "";
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val.trim();
  }
}

/** Loads root `.env` and `.env.local` (later files do not override already-set vars). */
export function loadMonorepoEnv(): void {
  const root = join(__dirname, "..");
  applyEnvFile(join(root, ".env"));
  applyEnvFile(join(root, ".env.local"));
}
