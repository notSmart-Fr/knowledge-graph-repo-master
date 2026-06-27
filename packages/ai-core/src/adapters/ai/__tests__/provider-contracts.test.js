import { describe, it, expect } from "bun:test";
describe("AI Provider Contracts", () => {
    it("should have IEmbeddingProvider interface with required methods", () => {
        const provider = {
            embed: async () => [],
            embedBatch: async () => [],
        };
        expect(provider.embed).toBeDefined();
        expect(provider.embedBatch).toBeDefined();
    });
    it("should have IAgentProvider interface with required methods", () => {
        const provider = {
            generate: async () => ({ text: "", metadata: { degraded: false, cacheHit: false } }),
            generateStream: async function* () { },
        };
        expect(provider.generate).toBeDefined();
        expect(provider.generateStream).toBeDefined();
    });
});
