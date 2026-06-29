/**
 * Streaming Orchestrator Tests
 *
 * Tests for T021 - processIntentStream()
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { Orchestrator } from "../orchestrator.js";
import { getCircuitBreaker } from "../circuit-breaker.js";
function createStreamingMocks() {
    const calls = { checkAndSet: 0, check: 0, getByPhone: 0, expand: 0, generateStream: 0 };
    const idempotencyStore = {
        checkAndSet: async () => { calls.checkAndSet++; return true; },
    };
    const cacheStore = {
        check: async () => { calls.check++; return null; },
        store: async () => { },
    };
    const contactStore = {
        getByPhone: async () => { calls.getByPhone++; return null; },
        getById: async () => null,
        search: async () => [],
    };
    const graphRetriever = {
        expandFromContact: async () => { calls.expand++; return { contact: undefined, account: undefined, deals: [], tickets: [], calls: [] }; },
        expandFromDeal: async () => ({ contact: undefined, account: undefined, deals: [], tickets: [], calls: [] }),
        getStaleDeals: async () => [],
    };
    const agentProvider = {
        generate: async () => ({
            text: "response",
            metadata: { degraded: false, cacheHit: false },
        }),
        generateStream: async function* () {
            calls.generateStream++;
            yield "Hello ";
            yield "world";
        },
    };
    const embeddingProvider = {
        embed: async () => new Array(768).fill(0),
        embedBatch: async () => [new Array(768).fill(0)],
    };
    return { calls, idempotencyStore, cacheStore, contactStore, graphRetriever, agentProvider, embeddingProvider };
}
describe("processIntentStream", () => {
    beforeEach(() => {
        getCircuitBreaker("supabase");
        getCircuitBreaker("neo4j");
        getCircuitBreaker("gemini");
    });
    test("yields streaming chunks", async () => {
        const mocks = createStreamingMocks();
        const config = {
            ...mocks,
            contactStore: mocks.contactStore,
            graphRetriever: mocks.graphRetriever,
            agentProvider: mocks.agentProvider,
            cacheStore: mocks.cacheStore,
            idempotencyStore: mocks.idempotencyStore,
            dealStore: {
                getByContact: async () => [],
                getById: async () => null,
                update: async (id) => ({ id }),
            },
            accountStore: {
                getById: async () => null,
                getHealthScore: async () => null,
            },
            ticketStore: {
                getByContact: async () => [],
                create: async () => ({}),
            },
        };
        const orchestrator = new Orchestrator(config);
        const chunks = [];
        let done = false;
        for await (const chunk of orchestrator.processIntentStream({
            sessionId: "stream-test-1",
            userId: "+1234567890",
            channel: "voice",
            message: "Hello",
            timestamp: "2024-01-01T00:00:00Z",
        })) {
            chunks.push(chunk.text);
            if (chunk.done) {
                done = true;
                break;
            }
        }
        expect(chunks).toContain("Hello ");
        expect(chunks).toContain("world");
        expect(done).toBe(true);
    });
    test("handles cache hit gracefully", async () => {
        const mocks = createStreamingMocks();
        const cachedResponse = {
            text: "Cached response",
            metadata: { degraded: false, cacheHit: true },
        };
        const cacheStoreWithHit = {
            check: async () => ({
                id: "test",
                response: cachedResponse,
                intentTags: [],
                model: "test",
                createdAt: new Date().toISOString(),
            }),
            store: async () => { },
        };
        const config = {
            ...mocks,
            cacheStore: cacheStoreWithHit,
        };
        const orchestrator = new Orchestrator(config);
        const chunks = [];
        for await (const chunk of orchestrator.processIntentStream({
            sessionId: "stream-test-2",
            userId: "+1234567890",
            channel: "voice",
            message: "Hello",
            timestamp: "2024-01-01T00:00:00Z",
        })) {
            chunks.push(chunk.text);
            if (chunk.done)
                break;
        }
        expect(chunks).toContain("Cached response");
    });
    test("returns fallback on error", async () => {
        const mocks = createStreamingMocks();
        const failingAgent = {
            generate: async () => ({ text: "x", metadata: {} }),
            generateStream: async function* () {
                throw new Error("Stream error");
            },
        };
        const config = {
            ...mocks,
            agentProvider: failingAgent,
        };
        const orchestrator = new Orchestrator(config);
        const chunks = [];
        for await (const chunk of orchestrator.processIntentStream({
            sessionId: "stream-test-3",
            userId: "+1234567890",
            channel: "voice",
            message: "Hello",
            timestamp: "2024-01-01T00:00:00Z",
        })) {
            chunks.push(chunk.text);
            if (chunk.done)
                break;
        }
        const fullText = chunks.join("");
        expect(fullText).toContain("trouble");
    });
});
