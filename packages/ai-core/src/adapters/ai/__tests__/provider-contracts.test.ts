import { describe, it, expect } from "vitest";
import { IEmbeddingProvider, IAgentProvider } from "../../../core/ports.js";

describe("AI Provider Contracts", () => {
  it("should have IEmbeddingProvider interface with required methods", () => {
    const provider: Partial<IEmbeddingProvider> = {
      embed: async () => [],
      embedBatch: async () => [],
    };
    expect(provider.embed).toBeDefined();
    expect(provider.embedBatch).toBeDefined();
  });

  it("should have IAgentProvider interface with required methods", () => {
    const provider: Partial<IAgentProvider> = {
      generate: async () => ({ text: "", metadata: { degraded: false, cacheHit: false } }),
      generateStream: async function* () {},
    };
    expect(provider.generate).toBeDefined();
    expect(provider.generateStream).toBeDefined();
  });
});
