import { createLogger } from "./logger.js";
import { CircuitBreakerOpenError } from "./errors.js";
import { getCircuitBreaker, } from "./circuit-breaker.js";
import { validateAndFilterOutput, } from "./sanitize.js";
import { initializeTelemetry, } from "./tracing.js";
const logger = createLogger("orchestrator");
// Initialize telemetry on module load
initializeTelemetry();
export class Orchestrator {
    breakers = new Map();
    config;
    constructor(config) {
        this.config = config;
        this.initializeCircuitBreakers();
    }
    initializeCircuitBreakers() {
        const adapters = [
            "supabase",
            "neo4j",
            "gemini",
            "deepseek",
            "redis",
            "bullmq",
        ];
        for (const adapter of adapters) {
            this.breakers.set(adapter, getCircuitBreaker(adapter));
        }
    }
    getActiveCircuitBreakers() {
        const active = [];
        for (const [name, breaker] of this.breakers) {
            const metrics = breaker.getMetrics();
            if (metrics.state === "open" || metrics.state === "half-open") {
                active.push(name);
            }
        }
        return active;
    }
    async processIntent(sessionContext) {
        const startTime = Date.now();
        const traceId = `${sessionContext.sessionId}-${Date.now()}`;
        logger.info("Starting orchestrator pipeline", {
            traceId,
            sessionId: sessionContext.sessionId,
            channel: sessionContext.channel,
        });
        const degradationMetadata = {
            degraded: false,
            cacheHit: false,
            activeCircuitBreakers: this.getActiveCircuitBreakers(),
        };
        try {
            // Step 1: Check idempotency
            const idempotencyKey = `${sessionContext.sessionId}-${sessionContext.timestamp}`;
            const isDuplicate = await this.checkIdempotency(idempotencyKey);
            if (isDuplicate) {
                logger.info("Duplicate request detected, returning cached response", { traceId });
                return {
                    response: {
                        text: "I've already processed this message. How else can I help?",
                        metadata: { degraded: false, cacheHit: true, modelUsed: "cache" },
                    },
                    metadata: { ...degradationMetadata, cacheHit: true },
                };
            }
            // Step 2: Hydrate session context
            const hydratedContext = await this.hydrateSession(sessionContext);
            // Step 3: Check cache
            const cachedResponse = await this.checkCache(hydratedContext);
            if (cachedResponse) {
                logger.info("Cache hit, returning cached response", { traceId });
                const filteredResponse = validateAndFilterOutput(cachedResponse.text);
                return {
                    response: {
                        text: filteredResponse,
                        metadata: { ...cachedResponse.metadata, cacheHit: true },
                    },
                    metadata: { ...degradationMetadata, cacheHit: true },
                };
            }
            // Step 4: Lookup contact
            const contact = await this.lookupContact(hydratedContext);
            // Step 5: Expand graph (with circuit breaker)
            let graphContext;
            try {
                graphContext = await this.expandGraph(contact);
            }
            catch (error) {
                if (error instanceof CircuitBreakerOpenError) {
                    logger.warn("Graph circuit breaker open, using fallback context", { traceId });
                    degradationMetadata.graphSkipped = true;
                    degradationMetadata.degraded = true;
                    graphContext = this.createFallbackGraphContext(contact);
                }
                else {
                    throw error;
                }
            }
            // Step 6: Call AI agent
            const agentResponse = await this.callAgent(graphContext, hydratedContext);
            // Step 7: Sanitize output
            const sanitizedText = validateAndFilterOutput(agentResponse.text);
            // Step 8: Store cache
            await this.storeCache(hydratedContext, { ...agentResponse, text: sanitizedText });
            // Step 9: Append session
            await this.appendSession(hydratedContext, sanitizedText);
            const totalTime = Date.now() - startTime;
            logger.info("Orchestrator pipeline completed", {
                traceId,
                totalTimeMs: totalTime,
                degraded: degradationMetadata.degraded,
            });
            return {
                response: {
                    text: sanitizedText,
                    metadata: {
                        degraded: degradationMetadata.degraded,
                        cacheHit: false,
                        modelUsed: agentResponse.metadata?.modelUsed,
                    },
                },
                metadata: {
                    ...degradationMetadata,
                    modelUsed: agentResponse.metadata?.modelUsed,
                },
            };
        }
        catch (error) {
            const totalTime = Date.now() - startTime;
            logger.error("Orchestrator pipeline failed", {
                traceId,
                totalTimeMs: totalTime,
                error: error instanceof Error ? error.message : String(error),
            });
            // Return fallback response
            return {
                response: {
                    text: "I'm sorry, I'm having trouble processing your request right now. Please try again in a moment.",
                    metadata: {
                        degraded: true,
                        cacheHit: false,
                        modelUsed: "fallback",
                    },
                },
                metadata: {
                    ...degradationMetadata,
                    degraded: true,
                },
            };
        }
    }
    async checkIdempotency(key) {
        try {
            return await this.config.idempotencyStore.checkAndSet(key, 300);
        }
        catch (error) {
            logger.warn("Idempotency check failed, continuing anyway", { error: String(error) });
            return false;
        }
    }
    async hydrateSession(context) {
        // For now, just return the context as-is
        // Future: enrich with user preferences, previous session context, etc.
        return context;
    }
    async checkCache(context) {
        try {
            const embedding = await this.config.embeddingProvider.embed(context.message);
            const cached = await this.config.cacheStore.check(embedding);
            if (cached) {
                // Extract OrchestratorResponse from CachedResponse
                return cached.response;
            }
        }
        catch (error) {
            logger.warn("Cache check failed", { error: String(error) });
        }
        return null;
    }
    async lookupContact(context) {
        // Extract phone from userId (assuming phone-based userId)
        // In a real system, this might be more complex
        const phone = context.userId;
        const contact = await this.config.contactStore.getByPhone(phone);
        return contact;
    }
    async expandGraph(contact) {
        if (!contact) {
            return {
                contact: undefined,
                account: undefined,
                deals: [],
                tickets: [],
                calls: [],
            };
        }
        return await this.config.graphRetriever.expandFromContact(contact.id);
    }
    createFallbackGraphContext(contact) {
        // When graph is unavailable, return minimal context with just contact info
        return {
            contact: contact || undefined,
            account: undefined,
            deals: [],
            tickets: [],
            calls: [],
        };
    }
    async callAgent(graphContext, sessionContext) {
        // Build context for the agent
        const context = {
            ...graphContext,
        };
        const response = await this.config.agentProvider.generate(context);
        return response;
    }
    async storeCache(context, response) {
        try {
            const embedding = await this.config.embeddingProvider.embed(context.message);
            await this.config.cacheStore.store(embedding, response);
        }
        catch (error) {
            logger.warn("Cache store failed", { error: String(error) });
        }
    }
    async appendSession(context, response) {
        // Future: append to session history
        // For now, just log
        logger.debug("Appending session", {
            sessionId: context.sessionId,
            responseLength: response.length,
        });
    }
}
// Factory function for convenience
export function createOrchestrator(config) {
    return new Orchestrator(config);
}
