import { createLogger } from "../core/logger.js";
import { getCircuitBreakerMetrics } from "../core/circuit-breaker.js";

const logger = createLogger("health-checks");

export type HealthStatus = "healthy" | "degraded" | "down";

export interface AdapterHealth {
  name: string;
  status: HealthStatus;
  latencyMs: number;
  lastChecked: string;
  error?: string;
  circuitBreakerState?: string;
}

export interface SystemHealth {
  timestamp: string;
  overall: HealthStatus;
  adapters: AdapterHealth[];
  failures: string[];
}

export type HealthCheckFn = () => Promise<{ healthy: boolean; latencyMs: number; error?: string }>;

interface RegisteredHealthCheck {
  name: string;
  check: HealthCheckFn;
  required: boolean;
  timeoutMs?: number;
}

const healthChecks: RegisteredHealthCheck[] = [];

export function registerHealthCheck(
  name: string,
  check: HealthCheckFn,
  required = true,
  timeoutMs = 5000
): void {
  healthChecks.push({ name, check, required, timeoutMs });
  logger.info(`Registered health check: ${name} (required: ${required})`);
}

export function unregisterHealthCheck(name: string): boolean {
  const index = healthChecks.findIndex(h => h.name === name);
  if (index !== -1) {
    healthChecks.splice(index, 1);
    logger.info(`Unregistered health check: ${name}`);
    return true;
  }
  return false;
}

export async function runHealthChecks(): Promise<SystemHealth> {
  const adapters: AdapterHealth[] = [];
  const failures: string[] = [];

  logger.debug("Running health checks...");

  for (const healthCheck of healthChecks) {
    const checkStart = Date.now();
    try {
      const result = await Promise.race([
        healthCheck.check(),
        new Promise<{ healthy: boolean; latencyMs: number; error?: string }>((_, reject) =>
          setTimeout(() => reject(new Error("Health check timeout")), healthCheck.timeoutMs ?? 5000)
        ),
      ]);

      const latencyMs = Date.now() - checkStart;
      const circuitMetrics = getCircuitBreakerMetrics(healthCheck.name);

      let status: HealthStatus;
      if (!result.healthy) {
        status = "down";
        if (healthCheck.required) failures.push(healthCheck.name);
      } else if (circuitMetrics?.state === "open") {
        status = "degraded";
      } else {
        status = "healthy";
      }

      adapters.push({
        name: healthCheck.name,
        status,
        latencyMs: result.latencyMs || latencyMs,
        lastChecked: new Date().toISOString(),
        error: result.error,
        circuitBreakerState: circuitMetrics?.state,
      });

      logger.debug(`Health check ${healthCheck.name}: ${status} (${latencyMs}ms)`);
    } catch (error: unknown) {
      const latencyMs = Date.now() - checkStart;
      const errorMessage = error instanceof Error ? error.message : String(error);

      adapters.push({
        name: healthCheck.name,
        status: "down",
        latencyMs,
        lastChecked: new Date().toISOString(),
        error: errorMessage,
      });

      if (healthCheck.required) failures.push(healthCheck.name);
      logger.error(`Health check ${healthCheck.name} failed`, { error: errorMessage });
    }
  }

  // Determine overall status
  let overall: HealthStatus;
  if (failures.length > 0) {
    overall = "down";
  } else if (adapters.some(a => a.status === "degraded")) {
    overall = "degraded";
  } else {
    overall = "healthy";
  }

  const totalTime = Date.now();
  logger.info(`Health checks completed - overall: ${overall}`);

  return {
    timestamp: new Date().toISOString(),
    overall,
    adapters,
    failures,
  };
}

export function createHealthCheckAdapter<T>(
  name: string,
  adapter: T,
  pingFn: (adapter: T) => Promise<void>,
  required = true
): void {
  registerHealthCheck(
    name,
    async () => {
      const start = Date.now();
      try {
        await pingFn(adapter);
        return { healthy: true, latencyMs: Date.now() - start };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { healthy: false, latencyMs: Date.now() - start, error: message };
      }
    },
    required
  );
}

/** Register LiveKit adapter health for /ready (non-required — degraded when down). */
export function registerLiveKitHealthCheck(healthCheck: () => Promise<boolean>): void {
  registerHealthCheck(
    "livekit",
    async () => {
      const start = Date.now();
      try {
        const healthy = await Promise.race([
          healthCheck(),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error("LiveKit health check timeout")), 3000)
          ),
        ]);
        return { healthy, latencyMs: Date.now() - start };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { healthy: false, latencyMs: Date.now() - start, error: message };
      }
    },
    false,
    3000
  );
}

/** Register Cartesia STT availability for /ready (API key present). */
export function registerCartesiaHealthCheck(isConfigured: () => boolean): void {
  registerHealthCheck(
    "cartesia",
    async () => {
      const start = Date.now();
      const healthy = isConfigured();
      return {
        healthy,
        latencyMs: Date.now() - start,
        error: healthy ? undefined : "CARTESIA_API_KEY not configured",
      };
    },
    false
  );
}

/** Register ffmpeg availability for voice-clip / WhatsApp audio paths. */
export function registerFfmpegHealthCheck(isAvailable: () => boolean): void {
  registerHealthCheck(
    "ffmpeg",
    async () => {
      const start = Date.now();
      const healthy = isAvailable();
      return {
        healthy,
        latencyMs: Date.now() - start,
        error: healthy ? undefined : "ffmpeg not found on PATH",
      };
    },
    false
  );
}
