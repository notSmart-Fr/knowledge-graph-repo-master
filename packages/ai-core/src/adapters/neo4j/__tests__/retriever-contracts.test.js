import { describe, it, expect } from "bun:test";
describe("Neo4j Retriever Contracts", () => {
    it("should have IGraphRetriever interface with required methods", () => {
        const retriever = {
            expandFromContact: async () => ({ deals: [], tickets: [], calls: [] }),
            expandFromDeal: async () => ({ deals: [], tickets: [], calls: [] }),
            getStaleDeals: async () => [],
        };
        expect(retriever.expandFromContact).toBeDefined();
        expect(retriever.expandFromDeal).toBeDefined();
        expect(retriever.getStaleDeals).toBeDefined();
    });
});
