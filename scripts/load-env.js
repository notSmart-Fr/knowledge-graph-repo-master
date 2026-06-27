// scripts/load-env.ts
// Loads .env from repo root for any script that needs env vars.
import { join } from "node:path";
function applyEnvFile(filePath) {
    const file = Bun.file(filePath);
    if (!file.exists())
        return;
    const text = file.text();
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)?$/);
        if (!match)
            continue;
        const key = match[1];
        if (process.env[key] !== undefined)
            continue;
        let val = match[2] ?? "";
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        process.env[key] = val.trim();
    }
}
/** Loads root .env only (no legacy app .env files). */
export function loadMonorepoEnv() {
    const root = join(import.meta.dir, "..");
    applyEnvFile(join(root, ".env"));
}
