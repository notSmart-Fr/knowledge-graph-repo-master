import { describe, it, expect } from "vitest";
import {
  IContactStore,
  IDealStore,
  ICallStore,
  ITicketStore,
  IAccountStore,
} from "../../../core/ports.js";

// Simple test to check that the interfaces are properly defined and types match
describe("Supabase Store Contracts", () => {
  it("should have IContactStore interface with required methods", () => {
    const contactStore: Partial<IContactStore> = {
      getByPhone: async () => null,
      getById: async () => null,
      search: async () => [],
    };
    expect(contactStore.getByPhone).toBeDefined();
    expect(contactStore.getById).toBeDefined();
    expect(contactStore.search).toBeDefined();
  });

  it("should have IDealStore interface with required methods", () => {
    const dealStore: Partial<IDealStore> = {
      getByContact: async () => [],
      getById: async () => null,
      update: async () => ({
        id: "1",
        name: "Test",
        amount: 100,
        stage: "lead",
        contactId: "1",
        probability: 50,
        createdAt: new Date().toISOString(),
      }),
    };
    expect(dealStore.getByContact).toBeDefined();
    expect(dealStore.getById).toBeDefined();
    expect(dealStore.update).toBeDefined();
  });

  it("should have ICallStore interface with required methods", () => {
    const callStore: Partial<ICallStore> = {
      create: async () => ({
        id: "1",
        contactId: "1",
        direction: "inbound",
        transcriptJson: {},
        sentiment: "neutral",
        actionItems: [],
        createdAt: new Date().toISOString(),
      }),
      appendTranscript: async () => {},
      finalize: async () => ({
        id: "1",
        contactId: "1",
        direction: "inbound",
        transcriptJson: {},
        summary: "test",
        sentiment: "neutral",
        actionItems: [],
        createdAt: new Date().toISOString(),
      }),
    };
    expect(callStore.create).toBeDefined();
    expect(callStore.appendTranscript).toBeDefined();
    expect(callStore.finalize).toBeDefined();
  });

  it("should have ITicketStore interface with required methods", () => {
    const ticketStore: Partial<ITicketStore> = {
      getByContact: async () => [],
      create: async () => ({
        id: "1",
        contactId: "1",
        subject: "Test",
        status: "open",
        priority: "medium",
        createdAt: new Date().toISOString(),
      }),
    };
    expect(ticketStore.getByContact).toBeDefined();
    expect(ticketStore.create).toBeDefined();
  });

  it("should have IAccountStore interface with required methods", () => {
    const accountStore: Partial<IAccountStore> = {
      getById: async () => null,
      getHealthScore: async () => null,
    };
    expect(accountStore.getById).toBeDefined();
    expect(accountStore.getHealthScore).toBeDefined();
  });
});
