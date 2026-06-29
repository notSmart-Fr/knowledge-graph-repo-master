import { describe, it, expect, beforeAll } from "vitest";
import { Orchestrator } from "../orchestrator.js";
import { resetAllCircuitBreakers } from "../circuit-breaker.js";
import { InMemoryDeadLetterQueue } from "../../adapters/messaging/bullmq-dlq.js";
import type {
  IAgentProvider,
  ICacheStore,
  IContactStore,
  IGraphRetriever,
  IEmbeddingProvider,
  IIdempotencyStore,
  CachedResponse,
  OrchestratorResponse,
  CRMGraphContext,
  Contact,
  IDealStore,
  IAccountStore,
  ITicketStore,
} from "../../core/ports.js";

interface MockOverrides {
  agentGenerate?: () => Promise<OrchestratorResponse>;
  cacheCheck?: () => Promise<CachedResponse | null>;
  graphExpand?: () => Promise<CRMGraphContext>;
  idempotencyCheckAndSet?: () => Promise<boolean>;
  idempotencyDegraded?: boolean;
  embeddingLastFallbackUsed?: boolean;
}

const sessionInput = {
  sessionId: "phase4",
  userId: "u1",
  channel: "test",
  message: "hello",
  timestamp: new Date().toISOString(),
} as never;

function buildConfig(overrides: MockOverrides = {}) {
  const contactStore: IContactStore = {
    getByPhone: async () =>
      ({
        id: "c1",
        name: "Tester",
        phone: "+1234567890",
        email: "t@e.com",
        role: "contact",
        tags: [],
        createdAt: new Date().toISOString(),
      }) as Contact,
    getById: async () => null,
    search: async () => [],
  };

  const graphRetriever: IGraphRetriever = {
    expandFromContact: async (id: string) =>
      overrides.graphExpand
        ? overrides.graphExpand()
        : ({
            contact: undefined,
            account: undefined,
            deals: [],
            tickets: [],
            calls: [],
          } as CRMGraphContext),
    expandFromDeal: async () => ({
      contact: undefined,
      account: undefined,
      deals: [],
      tickets: [],
      calls: [],
    }),
    getStaleDeals: async () => [],
  };

  const cacheStore: ICacheStore = {
    check: async () =>
      overrides.cacheCheck
        ? overrides.cacheCheck()
        : null,
    store: async () => undefined,
  };

  const agentProvider: IAgentProvider = {
    name: "mock-agent",
    generate: async () =>
      overrides.agentGenerate
        ? overrides.agentGenerate()
        : {
            text: "ok",
            metadata: { degraded: false, cacheHit: false, modelUsed: "gemini-2.0" },
          },
    generateStream: async function* () {
      yield "ok";
    },
  } as IAgentProvider;

  const idempotencyStore: IIdempotencyStore = {
    checkAndSet: async () => (overrides.idempotencyCheckAndSet ? overrides.idempotencyCheckAndSet() : false),
    isDegraded: () => overrides.idempotencyDegraded ?? false,
  };

  const embeddingProvider: IEmbeddingProvider = {
    embed: async () => new Array(768).fill(0),
    embedBatch: async () => [],
    lastFallbackUsed: () => overrides.embeddingLastFallbackUsed ?? false,
  };

  const dealStore: IDealStore = {
    getByContact: async () => [],
    getById: async () => null,
    update: async (id: string, fields: object) =>
      ({ id, ...fields }) as never,
  };

  const accountStore: IAccountStore = {
    getById: async () => null,
    getHealthScore: async () => null,
  };

  const ticketStore: ITicketStore = {
    getByContact: async () => [],
    create: async () => ({} as never),
  };

  return {
    contactStore,
    dealStore,
    accountStore,
    ticketStore,
    graphRetriever,
    embeddingProvider,
    agentProvider,
    cacheStore,
    idempotencyStore,
  };
}

beforeAll(() => {
  // Fresh breaker state for each test run
  resetAllCircuitBreakers();
});

describe("Phase 4: Degradation Metadata", () => {
  describe("T031 Cache fallback", () => {
    it("sets cacheFallbackUsed=true when embedding provider reports fallback", async () => {
      const cfg = buildConfig({ embeddingLastFallbackUsed: true });
      // sanity check on the mock before invoking orchestrator
      expect(cfg.embeddingProvider.lastFallbackUsed()).toBe(true);
      const orch = new Orchestrator(cfg);
      const result = await orch.processIntent(sessionInput);
      expect(result.metadata.cacheFallbackUsed).toBe(true);
      expect(result.metadata.degraded).toBe(true);
    });

    it("leaves cacheFallbackUsed unset when primary embedding is healthy", async () => {
      const cfg = buildConfig({ embeddingLastFallbackUsed: false });
      const orch = new Orchestrator(cfg);
      const result = await orch.processIntent(sessionInput);
      expect(result.metadata.cacheFallbackUsed).toBeUndefined();
    });
  });

  describe("T032 Idempotency degradation", () => {
    it("marks idempotencyDegraded=true when store reports fallback", async () => {
      const cfg = buildConfig({ idempotencyDegraded: true });
      const orch = new Orchestrator(cfg);
      const result = await orch.processIntent(sessionInput);
      expect(result.metadata.idempotencyDegraded).toBe(true);
      expect(result.metadata.degraded).toBe(true);
    });

    it("does not mark idempotency degraded for healthy primary", async () => {
      const cfg = buildConfig({ idempotencyDegraded: false });
      const orch = new Orchestrator(cfg);
      const result = await orch.processIntent(sessionInput);
      expect(result.metadata.idempotencyDegraded).toBeUndefined();
    });
  });

  describe("T033 Primary-model failure", () => {
    it("sets primaryModelFailed=true when agent reports degraded response", async () => {
      const cfg = buildConfig({
        agentGenerate: async () => ({
          text: "fallback reply",
          metadata: { degraded: true, cacheHit: false, modelUsed: "deepseek-chat" },
        }),
      });
      const orch = new Orchestrator(cfg);
      const result = await orch.processIntent(sessionInput);
      expect(result.metadata.primaryModelFailed).toBe(true);
      expect(result.metadata.modelUsed).toBe("deepseek-chat");
      expect(result.metadata.degraded).toBe(true);
    });
  });

  describe("Zero-drop guarantee", () => {
    it("returns a polite fallback message when every adapter fails (no exception)", async () => {
      const cfg = buildConfig({
        embeddingLastFallbackUsed: true,
        idempotencyDegraded: true,
        agentGenerate: () => {
          throw new Error("primary agent down");
        },
      });
      const orch = new Orchestrator(cfg);
      const result = await orch.processIntent(sessionInput);
      expect(result.response.text.length).toBeGreaterThan(0);
      expect(result.metadata.degraded).toBe(true);
    });
  });

  describe("T033a DLQ operator lifecycle", () => {
    it("enqueues, lists, replays, and purges dead jobs", async () => {
      resetAllCircuitBreakers();
      const dlq = new InMemoryDeadLetterQueue();

      const replayed: string[] = [];
      dlq.onReplay(async (job: Record<string, unknown>) => {
        replayed.push((job.idempotencyKey as string) ?? "unknown");
      });

      await dlq.enqueue(
        "messages",
        { idempotencyKey: "msg-1" },
        { errorCode: "X", errorMessage: "fail", attemptCount: 1, firstAttemptAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString() },
      );
      await dlq.enqueue(
        "messages",
        { idempotencyKey: "msg-2" },
        { errorCode: "X", errorMessage: "fail", attemptCount: 1, firstAttemptAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString() },
      );
      await dlq.enqueue(
        "calls",
        { idempotencyKey: "call-1" },
        { errorCode: "Y", errorMessage: "fail", attemptCount: 1, firstAttemptAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString() },
      );

      expect(await dlq.depth("messages")).toBe(2);
      expect(await dlq.depth("calls")).toBe(1);

      const listing = await dlq.listDead("messages");
      expect(listing).toHaveLength(2);

      const replayedEntry = await dlq.replay("messages", listing[0]!.id);
      expect(replayedEntry).not.toBeNull();
      expect(replayed).toContain("msg-1");
      expect(await dlq.depth("messages")).toBe(1);

      const purged = await dlq.purge("messages");
      expect(purged).toBe(1);
      expect(await dlq.depth("messages")).toBe(0);
    });

    it("supports paginated listDead with limit and offset", async () => {
      resetAllCircuitBreakers();
      const dlq = new InMemoryDeadLetterQueue();

      for (let i = 0; i < 5; i++) {
        await dlq.enqueue(
          "bulk",
          { idx: i },
          { errorCode: "X", errorMessage: "fail", attemptCount: 1, firstAttemptAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString() },
        );
      }

      const page1 = await dlq.listDead("bulk", 2, 0);
      const page2 = await dlq.listDead("bulk", 2, 2);
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0]!.id).not.toBe(page2[0]!.id);
    });

    it("returns null when replaying a missing job", async () => {
      resetAllCircuitBreakers();
      const dlq = new InMemoryDeadLetterQueue();
      const out = await dlq.replay("absent", "nope");
      expect(out).toBeNull();
    });
  });
});
