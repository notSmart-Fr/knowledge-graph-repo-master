import { createLogger } from "./logger.js";
import { CircuitBreakerOpenError, IntegrationError } from "./errors.js";
import {
  getCircuitBreaker,
  CircuitBreakerInstance,
} from "./circuit-breaker.js";
import {
  validateAndFilterOutput,
} from "./sanitize.js";
import {
  withSpan,
  recordCacheHit,
  recordCacheMiss,
  recordRequest,
  initializeTelemetry,
} from "./tracing.js";
import type {
  CRMGraphContext,
  OrchestratorResponse,
  IContactStore,
  IDealStore,
  IAccountStore,
  ITicketStore,
  IGraphRetriever,
  IEmbeddingProvider,
  IAgentProvider,
  ICacheStore,
  IIdempotencyStore,
} from "./ports.js";

const logger = createLogger("orchestrator");

// Initialize telemetry on module load
initializeTelemetry();

export interface OrchestratorConfig {
  contactStore: IContactStore;
  dealStore: IDealStore;
  accountStore: IAccountStore;
  ticketStore: ITicketStore;
  graphRetriever: IGraphRetriever;
  embeddingProvider: IEmbeddingProvider;
  agentProvider: IAgentProvider;
  cacheStore: ICacheStore;
  idempotencyStore: IIdempotencyStore;
}

export interface DegradationMetadata {
  degraded: boolean;
  cacheHit: boolean;
  graphSkipped?: boolean;
  cacheFallbackUsed?: boolean;
  idempotencyDegraded?: boolean;
  modelUsed?: string;
  activeCircuitBreakers: string[];
}

export interface OrchestratorResult {
  response: OrchestratorResponse;
  metadata: DegradationMetadata;
}

export interface OrchestratorChunk {
  text: string;
  done: boolean;
  metadata?: Partial<DegradationMetadata>;
}

interface SessionContext {
  sessionId: string;
  userId: string;
  channel: string;
  message: string;
  timestamp: string;
  previousContext?: string[];
}

export class Orchestrator {
  private breakers: Map<string, CircuitBreakerInstance> = new Map();
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.initializeCircuitBreakers();
  }

  private initializeCircuitBreakers(): void {
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

  private getActiveCircuitBreakers(): string[] {
    const active: string[] = [];
    for (const [name, breaker] of this.breakers) {
      const metrics = breaker.getMetrics();
      if (metrics.state === "open" || metrics.state === "half-open") {
        active.push(name);
      }
    }
    return active;
  }

  async processIntent(
    sessionContext: SessionContext
  ): Promise<OrchestratorResult> {
    const startTime = Date.now();
    const traceId = `${sessionContext.sessionId}-${Date.now()}`;

    logger.info("Starting orchestrator pipeline", {
      traceId,
      sessionId: sessionContext.sessionId,
      channel: sessionContext.channel,
    });

    const degradationMetadata: DegradationMetadata = {
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
      let graphContext: CRMGraphContext;
      try {
        graphContext = await this.expandGraph(contact);
      } catch (error: unknown) {
        if (error instanceof CircuitBreakerOpenError) {
          logger.warn("Graph circuit breaker open, using fallback context", { traceId });
          degradationMetadata.graphSkipped = true;
          degradationMetadata.degraded = true;
          graphContext = this.createFallbackGraphContext(contact);
        } else {
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
    } catch (error: unknown) {
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

  private async checkIdempotency(key: string): Promise<boolean> {
    try {
      return await this.config.idempotencyStore.checkAndSet(key, 300);
    } catch (error: unknown) {
      logger.warn("Idempotency check failed, continuing anyway", { error: String(error) });
      return false;
    }
  }

  private async hydrateSession(
    context: SessionContext
  ): Promise<SessionContext> {
    // For now, just return the context as-is
    // Future: enrich with user preferences, previous session context, etc.
    return context;
  }

  private async checkCache(context: SessionContext): Promise<OrchestratorResponse | null> {
    try {
      const embedding = await this.config.embeddingProvider.embed(context.message);
      const cached = await this.config.cacheStore.check(embedding);
      if (cached) {
        // Extract OrchestratorResponse from CachedResponse
        return cached.response as unknown as OrchestratorResponse;
      }
    } catch (error: unknown) {
      logger.warn("Cache check failed", { error: String(error) });
    }
    return null;
  }

  private async lookupContact(context: SessionContext): ReturnType<IContactStore["getByPhone"]> {
    // Extract phone from userId (assuming phone-based userId)
    // In a real system, this might be more complex
    const phone = context.userId;
    const contact = await this.config.contactStore.getByPhone(phone);
    return contact;
  }

  private async expandGraph(
    contact: Awaited<ReturnType<IContactStore["getByPhone"]>>
  ): Promise<CRMGraphContext> {
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

  private createFallbackGraphContext(
    contact: Awaited<ReturnType<IContactStore["getByPhone"]>>
  ): CRMGraphContext {
    // When graph is unavailable, return minimal context with just contact info
    return {
      contact: contact || undefined,
      account: undefined,
      deals: [],
      tickets: [],
      calls: [],
    };
  }

  private async callAgent(
    graphContext: CRMGraphContext,
    sessionContext: SessionContext
  ): Promise<OrchestratorResponse> {
    // Build context for the agent
    const context: CRMGraphContext = {
      ...graphContext,
    };

    const response = await this.config.agentProvider.generate(context);
    return response;
  }

  private async storeCache(
    context: SessionContext,
    response: OrchestratorResponse
  ): Promise<void> {
    try {
      const embedding = await this.config.embeddingProvider.embed(context.message);
      await this.config.cacheStore.store(embedding, response);
    } catch (error: unknown) {
      logger.warn("Cache store failed", { error: String(error) });
    }
  }

  private async appendSession(
    context: SessionContext,
    response: string
  ): Promise<void> {
    // Future: append to session history
    // For now, just log
    logger.debug("Appending session", {
      sessionId: context.sessionId,
      responseLength: response.length,
    });
  }
}

// Factory function for convenience
export function createOrchestrator(config: OrchestratorConfig): Orchestrator {
  return new Orchestrator(config);
}
