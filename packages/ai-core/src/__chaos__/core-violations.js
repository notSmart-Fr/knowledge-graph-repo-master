// This file lives in packages/ai-core/src/__chaos__/ to trigger path-scoped rules
// Rule 16: Port Injection violations
// Rule 17: Circuit Breaker violations (if we were in core/orchestrator)
// Rule 14: Span Coverage violations
// Rule 16: Direct adapter instantiation in core/ (violation!)
const store = new SupabaseContactStore();
const retriever = new Neo4jGraphRetriever();
const embed = new GeminiEmbeddingProvider();
// Rule 14: Exported function calling external services without startActiveSpan (violation!)
export async function processDeal(id) {
    // Calls external service (supabase, etc.) without tracer.startActiveSpan()!
    const deal = await store.get(id);
    return deal;
}
// Now a copy of this but in core/orchestrator/ path for Rule17
// (we'll create a fake "orchestrator" directory in __chaos__)
