/**
 * Standalone health/readiness server (:8280).
 *
 * Usage: npx tsx scripts/health-server.ts
 */

import { loadMonorepoEnv } from "./load-env.js";
import { startGlobalHealthRouter } from "../packages/ai-core/src/health/health-router.js";
import { createLogger } from "../packages/ai-core/src/core/logger.js";
import { runStartupValidation } from "../packages/ai-core/src/config/startup-validator.js";
import { registerProductionHealthChecks } from "./register-production-health.js";

loadMonorepoEnv();

const logger = createLogger("health-server");

registerProductionHealthChecks();
await runStartupValidation();
await startGlobalHealthRouter();
logger.info("Health server running on http://localhost:8280 (/health, /ready)");
