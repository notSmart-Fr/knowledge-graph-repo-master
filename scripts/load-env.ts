import fs from "node:fs";
import path from "node:path";

function applyEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;

  const envConfig = fs.readFileSync(filePath, "utf8");
  for (const line of envConfig.split(/\r?\n/)) {
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

/** Loads apps/backend, apps/storefront, then scripts/.env (later files do not override shell exports). */
export function loadMonorepoEnv() {
  const root = process.cwd();
  applyEnvFile(path.join(root, "apps/backend/.env"));
  applyEnvFile(path.join(root, "apps/storefront/.env"));
  applyEnvFile(path.join(root, "scripts/.env"));
}
