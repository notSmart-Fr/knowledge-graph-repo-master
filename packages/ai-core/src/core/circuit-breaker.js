import { createLogger } from "./logger.js";
import { CircuitBreakerOpenError } from "./errors.js";
const logger = createLogger("circuit-breaker");
export class CircuitBreakerInstance {
    name;
    config;
    state = "closed";
    failures = 0;
    successes = 0;
    lastFailureTime;
    lastSuccessTime;
    totalCalls = 0;
    openCount = 0;
    halfOpenProbeLock = false;
    halfOpenProbeTimeout;
    constructor(name, config) {
        this.name = name;
        this.config = config;
    }
    getMetrics() {
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
    async execute(fn) {
        this.totalCalls++;
        if (this.state === "open") {
            if (this.shouldAttemptReset()) {
                logger.info(`Circuit ${this.name} transitioning to half-open`);
                this.state = "half-open";
            }
            else {
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
            }
            else {
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
        }
        catch (error) {
            this.onFailure();
            throw error;
        }
    }
    shouldAttemptReset() {
        if (!this.lastFailureTime)
            return true;
        return Date.now() - this.lastFailureTime >= this.config.cooldownMs;
    }
    onSuccess() {
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
    onFailure() {
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
        }
        else if (this.state === "closed" && this.failures >= this.config.failureThreshold) {
            logger.warn(`Circuit ${this.name} opened after ${this.failures} failures`);
            this.state = "open";
            this.openCount++;
        }
    }
}
const breakers = new Map();
export function getCircuitBreaker(name, config) {
    if (!breakers.has(name)) {
        const fullConfig = {
            failureThreshold: config?.failureThreshold ?? 3,
            cooldownMs: config?.cooldownMs ?? 30000,
            halfOpenProbeTimeoutMs: config?.halfOpenProbeTimeoutMs ?? 5000,
        };
        breakers.set(name, new CircuitBreakerInstance(name, fullConfig));
        logger.info(`Created circuit breaker: ${name}`, { config: fullConfig });
    }
    return breakers.get(name);
}
export function getCircuitBreakerMetrics(name) {
    const breaker = breakers.get(name);
    return breaker ? breaker.getMetrics() : null;
}
export function getAllCircuitBreakerMetrics() {
    const metrics = {};
    breakers.forEach((breaker, name) => {
        metrics[name] = breaker.getMetrics();
    });
    return metrics;
}
export function resetCircuitBreaker(name) {
    const breaker = breakers.get(name);
    if (breaker) {
        breakers.delete(name);
        logger.info(`Reset circuit breaker: ${name}`);
        return true;
    }
    return false;
}
export function resetAllCircuitBreakers() {
    breakers.clear();
    logger.info("Reset all circuit breakers");
}
