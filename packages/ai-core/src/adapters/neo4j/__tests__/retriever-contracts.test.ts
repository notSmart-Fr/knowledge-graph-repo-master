import { describe, it, expect } from "vitest";
import { IGraphRetriever } from "../../../core/ports.js";

describe("Neo4j Retriever Contracts", () => {
  it("should have IGraphRetriever interface with required methods", () => {
    const retriever: Partial<IGraphRetriever> = {
      expandFromContact: async () => ({ deals: [], tickets: [], calls: [] }),
      expandFromDeal: async () => ({ deals: [], tickets: [], calls: [] }),
      getStaleDeals: async () => [],
    };
    expect(retriever.expandFromContact).toBeDefined();
    expect(retriever.expandFromDeal).toBeDefined();
    expect(retriever.getStaleDeals).toBeDefined();
  });
});
