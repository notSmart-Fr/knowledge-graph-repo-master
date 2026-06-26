// This file lives in __chaos__/core/orchestrator to trigger Rule17 (Circuit Breaker)
import type { GraphRetriever } from "../../../core/ports"; // (stub)

class Orchestrator {
  constructor(
    private graphRetriever: GraphRetriever,
  ) {}

  // Rule 17: Call graphRetriever.expandFromContact() without circuit breaker (violation!)
  async processContactIntent(contactId: string) {
    return this.graphRetriever.expandFromContact(contactId); 
  }
}

