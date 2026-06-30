import { createLogger } from "../core/logger.js";
import { execSync } from "node:child_process";

const logger = createLogger("startup-validator");

export interface StartupCheck {
  name: string;
  check: () => Promise<boolean> | boolean;
  required: boolean;
}

export interface StartupValidationResult {
  name: string;
  passed: boolean;
  required: boolean;
  error?: string;
}

export interface StartupValidationReport {
  timestamp: string;
  allPassed: boolean;
  requiredPassed: boolean;
  results: StartupValidationResult[];
}

function getEnvVar(name: string): string | undefined {
  return process.env[name];
}

function checkEnvVar(name: string): boolean {
  const value = getEnvVar(name);
  return value !== undefined && value.length > 0;
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

const startupChecks: StartupCheck[] = [
  {
    name: "SUPABASE_URL",
    check: () => {
      const url = getEnvVar("SUPABASE_URL");
      return url !== undefined && isValidUrl(url);
    },
    required: true,
  },
  {
    name: "NEO4J_URI",
    check: () => {
      const uri = getEnvVar("NEO4J_URI");
      return uri !== undefined && isValidUrl(uri);
    },
    required: true,
  },
  {
    name: "REDIS_URL",
    check: () => {
      const url = getEnvVar("REDIS_URL");
      return url !== undefined && isValidUrl(url);
    },
    required: true,
  },
  {
    name: "GEMINI_API_KEY",
    check: () => checkEnvVar("GEMINI_API_KEY"),
    required: true,
  },
  {
    name: "ENCRYPTION_MASTER_KEY",
    check: () => {
      const key = getEnvVar("ENCRYPTION_MASTER_KEY");
      return key !== undefined && key.length === 64; // 32-byte hex key
    },
    required: true,
  },
  {
    name: "BULLMQ_REDIS_URL",
    check: () => {
      // BULLMQ can use the same Redis URL, or a dedicated one
      // It's optional if REDIS_URL is provided
      const bullMqUrl = getEnvVar("BULLMQ_REDIS_URL");
      const redisUrl = getEnvVar("REDIS_URL");
      return bullMqUrl !== undefined ? isValidUrl(bullMqUrl) : redisUrl !== undefined;
    },
    required: true,
  },
];

export async function runStartupValidation(crashOnFailure = true): Promise<StartupValidationReport> {
  logger.info("Running startup validation...");

  const results: StartupValidationResult[] = [];
  let requiredPassed = true;

  for (const check of startupChecks) {
    try {
      const passed = await Promise.resolve(check.check());
      results.push({
        name: check.name,
        passed,
        required: check.required,
        error: passed ? undefined : `Check failed for ${check.name}`,
      });

      if (!passed && check.required) {
        requiredPassed = false;
      }

      logger.info(`Startup check ${check.name}: ${passed ? "PASSED" : "FAILED"}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({
        name: check.name,
        passed: false,
        required: check.required,
        error: errorMessage,
      });

      if (check.required) {
        requiredPassed = false;
      }

      logger.error(`Startup check ${check.name} threw error`, { error: errorMessage });
    }
  }

  const allPassed = results.every(r => r.passed);
  const report: StartupValidationReport = {
    timestamp: new Date().toISOString(),
    allPassed,
    requiredPassed,
    results,
  };

  if (!requiredPassed && crashOnFailure) {
    logger.error("Required startup checks failed - crashing process", { report });
    console.error("\n❌ STARTUP VALIDATION FAILED\n");
    for (const result of results) {
      if (!result.passed && result.required) {
        console.error(`  ✗ ${result.name}: ${result.error}`);
      }
    }
    console.error("\nPlease check your environment variables.\n");
    process.exit(1);
  }

  if (allPassed) {
    logger.info("All startup checks passed");
  } else {
    logger.warn("Some optional startup checks failed", { report });
  }

  return report;
}

// Graceful shutdown handler - required for ungraceful exit detection
function setupGracefulShutdown(): void {
  let isShuttingDown = false;

  const shutdown = (signal: string) => {
    if (!isShuttingDown) {
      isShuttingDown = true;
      logger.info(`Received ${signal}, shutting down gracefully...`);
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Initialize graceful shutdown handlers
setupGracefulShutdown();

export function addStartupCheck(check: StartupCheck): void {
  startupChecks.push(check);
}

export function getStartupChecks(): readonly StartupCheck[] {
  return [...startupChecks];
}

/** Register widget-server optional checks (LiveKit reachability, ffmpeg). */
export function registerWidgetStartupChecks(options?: {
  liveKitHealthCheck?: () => Promise<boolean>;
}): void {
  if (options?.liveKitHealthCheck) {
    addStartupCheck({
      name: "LIVEKIT_HEALTH",
      check: async () => {
        try {
          return await options.liveKitHealthCheck!();
        } catch {
          return false;
        }
      },
      required: false,
    });
  }

  addStartupCheck({
    name: "FFMPEG_AVAILABLE",
    check: () => {
      try {
        execSync("ffmpeg -version", { stdio: "ignore" });
        return true;
      } catch {
        logger.warn("ffmpeg not found — voice clip and WhatsApp audio paths degraded");
        return false;
      }
    },
    required: false,
  });
}
