// This file lives in __chaos__/core/orchestrator to trigger Rule14, Rule16, Rule17
import type { GraphRetriever } from "../../../core/ports"; // (stub)

// Stubs for chaos tests
declare class SupabaseContactStore {}
declare class Neo4jGraphRetriever {}
declare class GeminiEmbeddingProvider {}

class Orchestrator {
  constructor(
    private graphRetriever: GraphRetriever,
  ) {}

  // Rule 17: Call graphRetriever.expandFromContact() without circuit breaker (violation!)
  async processContactIntent(contactId: string) {
    return this.graphRetriever.expandFromContact(contactId); 
  }
}

// Rule 16: Direct adapter instantiation in core/ (violation!)
const store = new SupabaseContactStore();
const retriever = new Neo4jGraphRetriever();
const embed = new GeminiEmbeddingProvider();

// Rule 14: Exported function calling external services without startActiveSpan (violation!)
export async function processDeal(id: string) {
  const deal = await fetch("https://api.example.com/deal/" + id);
  return deal;
}
