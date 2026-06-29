import { createLogger } from "../core/logger.js";
import { getCircuitBreakerMetrics } from "../core/circuit-breaker.js";
const logger = createLogger("health-checks");
const healthChecks = [];
export function registerHealthCheck(name, check, required = true) {
    healthChecks.push({ name, check, required });
    logger.info(`Registered health check: ${name} (required: ${required})`);
}
export function unregisterHealthCheck(name) {
    const index = healthChecks.findIndex(h => h.name === name);
    if (index !== -1) {
        healthChecks.splice(index, 1);
        logger.info(`Unregistered health check: ${name}`);
        return true;
    }
    return false;
}
export async function runHealthChecks() {
    const adapters = [];
    const failures = [];
    logger.debug("Running health checks...");
    for (const healthCheck of healthChecks) {
        const checkStart = Date.now();
        try {
            const result = await Promise.race([
                healthCheck.check(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Health check timeout")), 5000)),
            ]);
            const latencyMs = Date.now() - checkStart;
            const circuitMetrics = getCircuitBreakerMetrics(healthCheck.name);
            let status;
            if (!result.healthy) {
                status = "down";
                if (healthCheck.required)
                    failures.push(healthCheck.name);
            }
            else if (circuitMetrics?.state === "open") {
                status = "degraded";
            }
            else {
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
        }
        catch (error) {
            const latencyMs = Date.now() - checkStart;
            const errorMessage = error instanceof Error ? error.message : String(error);
            adapters.push({
                name: healthCheck.name,
                status: "down",
                latencyMs,
                lastChecked: new Date().toISOString(),
                error: errorMessage,
            });
            if (healthCheck.required)
                failures.push(healthCheck.name);
            logger.error(`Health check ${healthCheck.name} failed`, { error: errorMessage });
        }
    }
    // Determine overall status
    let overall;
    if (failures.length > 0) {
        overall = "down";
    }
    else if (adapters.some(a => a.status === "degraded")) {
        overall = "degraded";
    }
    else {
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
export function createHealthCheckAdapter(name, adapter, pingFn, required = true) {
    registerHealthCheck(name, async () => {
        const start = Date.now();
        try {
            await pingFn(adapter);
            return { healthy: true, latencyMs: Date.now() - start };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { healthy: false, latencyMs: Date.now() - start, error: message };
        }
    }, required);
}
