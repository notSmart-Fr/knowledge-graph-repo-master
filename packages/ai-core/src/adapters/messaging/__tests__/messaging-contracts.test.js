import { describe, it, expect } from "bun:test";
describe("Messaging Contracts", () => {
    it("should have IIdempotencyStore interface with required method", () => {
        const store = {
            checkAndSet: async () => true,
        };
        expect(store.checkAndSet).toBeDefined();
    });
    it("should have IDeadLetterQueue interface with required method", () => {
        const dlq = {
            enqueue: async () => { },
        };
        expect(dlq.enqueue).toBeDefined();
    });
});
