/**
 * OTel instrumentation for the AI CRM
 *
 * Provides:
 * - Span creation for orchestrator pipeline steps
 * - Cache metrics (hit/miss ratio)
 * - Per-step latency tracking
 */
import { trace, SpanStatusCode, context, SpanKind } from "@opentelemetry/api";
import { metrics } from "@opentelemetry/api";
import { createLogger } from "./logger.js";
const logger = createLogger("otel");
// Pipeline step names (max 8 spans per request per Firewall Rule 14)
export const PIPELINE_STEPS = [
    "hydrate",
    "cache_check",
    "contact_lookup",
    "graph_expand",
    "agent_generate",
    "sanitize",
    "cache_store",
    "session_append",
];
// Tracer
const tracer = trace.getTracer("ai-crm-orchestrator", "1.0.0");
// Metrics
const meter = metrics.getMeter("ai-crm-orchestrator", "1.0.0");
// Cache metrics
export const cacheHitCounter = meter.createCounter("cache_hit_total", {
    description: "Total number of cache hits",
});
export const cacheMissCounter = meter.createCounter("cache_miss_total", {
    description: "Total number of cache misses",
});
export const cacheHitRatioGauge = meter.createObservableGauge("cache_hit_ratio", {
    description: "Cache hit ratio (0-1)",
});
let totalHits = 0;
let totalMisses = 0;
cacheHitRatioGauge.addCallback((observableResult) => {
    const total = totalHits + totalMisses;
    const ratio = total > 0 ? totalHits / total : 0;
    observableResult.observe(ratio);
});
// Request metrics
export const requestLatencyHistogram = meter.createHistogram("orchestrator_request_latency_ms", {
    description: "End-to-end orchestrator request latency in milliseconds",
    unit: "ms",
});
export const requestCounter = meter.createCounter("orchestrator_requests_total", {
    description: "Total number of orchestrator requests",
});
export const errorCounter = meter.createCounter("orchestrator_errors_total", {
    description: "Total number of orchestrator errors",
});
// Pipeline step metrics
const stepLatencyHistograms = {};
const stepCounter = {};
for (const step of PIPELINE_STEPS) {
    stepLatencyHistograms[step] = meter.createHistogram(`orchestrator_step_${step}_latency_ms`, {
        description: `Latency for ${step} step in milliseconds`,
        unit: "ms",
    });
    stepCounter[step] = meter.createCounter(`orchestrator_step_${step}_total`, {
        description: `Total number of ${step} step executions`,
    });
}
// Span creation helper
export function createSpan(name, traceId) {
    const span = tracer.startSpan(name, {
        kind: SpanKind.INTERNAL,
        attributes: {
            "orchestrator.step": name,
            "orchestrator.trace_id": traceId || "unknown",
        },
    });
    return span;
}
// Execute a pipeline step with span instrumentation
export async function withSpan(step, fn, traceId) {
    const span = createSpan(step, traceId);
    const startTime = Date.now();
    try {
        const result = await context.with(trace.setSpan(context.active(), span), fn);
        const latencyMs = Date.now() - startTime;
        spanLatency(span, latencyMs);
        stepLatencyHistograms[step].record(latencyMs);
        stepCounter[step].add(1);
        return result;
    }
    catch (error) {
        const latencyMs = Date.now() - startTime;
        spanLatency(span, latencyMs, error);
        stepLatencyHistograms[step].record(latencyMs);
        stepCounter[step].add(1);
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
    }
    finally {
        span.end();
    }
}
function spanLatency(span, latencyMs, error) {
    span.setAttribute("duration_ms", latencyMs);
    if (error) {
        span.setAttribute("error", true);
        // ponytail: Error messages can contain PII. Only export error type, not message.
        span.setAttribute("error.type", error instanceof Error ? error.name : "UnknownError");
    }
}
// Record cache hit/miss
export function recordCacheHit() {
    totalHits++;
    cacheHitCounter.add(1);
}
export function recordCacheMiss() {
    totalMisses++;
    cacheMissCounter.add(1);
}
// Record overall request
export function recordRequest(latencyMs, error) {
    requestCounter.add(1);
    requestLatencyHistogram.record(latencyMs);
    if (error) {
        errorCounter.add(1);
    }
}
// Get current metrics for health checks
export function getCacheMetrics() {
    const total = totalHits + totalMisses;
    return {
        hits: totalHits,
        misses: totalMisses,
        ratio: total > 0 ? totalHits / total : 0,
    };
}
// Initialize OTel (call at startup)
export function initializeTelemetry() {
    logger.info("Initializing OpenTelemetry instrumentation", {
        serviceName: "ai-crm-orchestrator",
        steps: PIPELINE_STEPS.length,
    });
}
