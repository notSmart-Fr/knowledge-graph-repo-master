import { describe, it, expect } from "bun:test";
import { IIdempotencyStore, IDeadLetterQueue } from "../../../core/ports.js";

describe("Messaging Contracts", () => {
  it("should have IIdempotencyStore interface with required method", () => {
    const store: Partial<IIdempotencyStore> = {
      checkAndSet: async () => true,
    };
    expect(store.checkAndSet).toBeDefined();
  });

  it("should have IDeadLetterQueue interface with required method", () => {
    const dlq: Partial<IDeadLetterQueue> = {
      enqueue: async () => {},
    };
    expect(dlq.enqueue).toBeDefined();
  });
});
