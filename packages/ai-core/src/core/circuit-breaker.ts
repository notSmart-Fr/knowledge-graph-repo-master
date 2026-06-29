import { createLogger } from "./logger.js";
import { CircuitBreakerOpenError } from "./errors.js";

const logger = createLogger("circuit-breaker");

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  cooldownMs: number;
  halfOpenProbeTimeoutMs: number;
}

export interface CircuitBreakerMetrics {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  totalCalls: number;
  openCount: number;
}

export class CircuitBreakerInstance {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  private totalCalls = 0;
  private openCount = 0;
  private halfOpenProbeLock = false;
  private halfOpenProbeTimeout?: ReturnType<typeof setTimeout>;

  constructor(
    private name: string,
    private config: CircuitBreakerConfig
  ) {}

  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalCalls: this.totalCalls,
      openCount: this.openCount,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    if (this.state === "open") {
      if (this.shouldAttemptReset()) {
        logger.info(`Circuit ${this.name} transitioning to half-open`);
        this.state = "half-open";
      } else {
        logger.debug(`Circuit ${this.name} open, rejecting call`);
        throw new CircuitBreakerOpenError(this.name);
      }
    }

    if (this.state === "half-open") {
      if (this.halfOpenProbeLock) {
        logger.debug(`Circuit ${this.name} half-open probe in progress, waiting`);
        const waitStart = Date.now();
        while (this.halfOpenProbeLock && Date.now() - waitStart < this.config.halfOpenProbeTimeoutMs) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (this.halfOpenProbeLock) {
          throw new CircuitBreakerOpenError(this.name);
        }
        // After waiting, check if the circuit is still usable
        // The state may have changed via onSuccess/onFailure
        // Just let it proceed - if state is still open, we'll throw in try block
      } else {
        this.halfOpenProbeLock = true;
        this.halfOpenProbeTimeout = setTimeout(() => {
          this.halfOpenProbeLock = false;
          logger.warn(`Circuit ${this.name} probe timeout, remaining half-open`);
        }, this.config.halfOpenProbeTimeoutMs);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error: unknown) {
      this.onFailure();
      throw error;
    }
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return true;
    return Date.now() - this.lastFailureTime >= this.config.cooldownMs;
  }

  private onSuccess(): void {
    this.successes++;
    this.lastSuccessTime = Date.now();

    if (this.halfOpenProbeLock) {
      this.halfOpenProbeLock = false;
      if (this.halfOpenProbeTimeout) {
        clearTimeout(this.halfOpenProbeTimeout);
        this.halfOpenProbeTimeout = undefined;
      }
    }

    if (this.state === "half-open") {
      logger.info(`Circuit ${this.name} closed after successful probe`);
      this.state = "closed";
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.halfOpenProbeLock) {
      this.halfOpenProbeLock = false;
      if (this.halfOpenProbeTimeout) {
        clearTimeout(this.halfOpenProbeTimeout);
        this.halfOpenProbeTimeout = undefined;
      }
    }

    if (this.state === "half-open") {
      logger.warn(`Circuit ${this.name} reopened after probe failure`);
      this.state = "open";
      this.openCount++;
    } else if (this.state === "closed" && this.failures >= this.config.failureThreshold) {
      logger.warn(`Circuit ${this.name} opened after ${this.failures} failures`);
      this.state = "open";
      this.openCount++;
    }
  }
}

const breakers = new Map<string, CircuitBreakerInstance>();

export function getCircuitBreaker(
  name: string,
  config?: Partial<CircuitBreakerConfig>
): CircuitBreakerInstance {
  if (!breakers.has(name)) {
    const fullConfig: CircuitBreakerConfig = {
      failureThreshold: config?.failureThreshold ?? 3,
      cooldownMs: config?.cooldownMs ?? 30000,
      halfOpenProbeTimeoutMs: config?.halfOpenProbeTimeoutMs ?? 5000,
    };
    breakers.set(name, new CircuitBreakerInstance(name, fullConfig));
    logger.info(`Created circuit breaker: ${name}`, { config: fullConfig });
  }
  return breakers.get(name)!;
}

export function getCircuitBreakerMetrics(name: string): CircuitBreakerMetrics | null {
  const breaker = breakers.get(name);
  return breaker ? breaker.getMetrics() : null;
}

export function getAllCircuitBreakerMetrics(): Record<string, CircuitBreakerMetrics> {
  const metrics: Record<string, CircuitBreakerMetrics> = {};
  breakers.forEach((breaker, name) => {
    metrics[name] = breaker.getMetrics();
  });
  return metrics;
}

export function resetCircuitBreaker(name: string): boolean {
  const breaker = breakers.get(name);
  if (breaker) {
    breakers.delete(name);
    logger.info(`Reset circuit breaker: ${name}`);
    return true;
  }
  return false;
}

export function resetAllCircuitBreakers(): void {
  breakers.clear();
  logger.info("Reset all circuit breakers");
}
