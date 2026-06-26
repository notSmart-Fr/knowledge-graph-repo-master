# AURA — Test Suite Reference

Run all tests:

```powershell
pnpm test
```

Expected result: **18 tests across 5 files, all passing, no network calls.**

---

## File Map

| Test file | What it covers |
|---|---|
| `packages/ai-core/src/__tests__/vendure-client.test.ts` | Shared HTTP client — the gateway to Vendure |
| `packages/ai-core/src/__tests__/orchestrator.test.ts` | The AI brain — session keys, cache, graceful degradation |
| `packages/ai-core/src/__tests__/tools.test.ts` | Mastra agent tools — schemas and execute mapping |
| `packages/ai-core/src/__tests__/embedding.client.test.ts` | Gemini embedding wrapper |
| `packages/ai-core/src/__tests__/graph-retriever.test.ts` | Vector + graph hybrid retrieval |

---

## What Each File Tests

### `vendure-client.test.ts`

The `runVendureQuery` function is the single gateway between every AI-core agent tool and the Vendure commerce backend. All four tools (`searchCatalog`, `exploreProduct`, `modifyCart`, `showRecommendations`) call it.

| Test | What it proves |
|---|---|
| Happy path → returns typed data | A well-formed GraphQL response is parsed and returned correctly |
| HTTP 500 → throws `IntegrationError` | When Vendure is down, the caller gets a typed error with code `UPSTREAM_API_ERROR`, not an untyped crash |
| GraphQL errors → throws `IntegrationError` | When a query is rejected by Vendure (auth, malformed query), the exact Vendure error message is surfaced |

---

### `orchestrator.test.ts`

`OrchestratorService.processIntent` is the single source of truth for all channels (Web, WhatsApp, Voice). It drives a 7-step pipeline: semantic cache → embedding → vector search → variant hydration → graph expansion → shopAgent → cache write.

**Helper tests** (pure unit, no I/O):

| Test | What it proves |
|---|---|
| Session key format | Redis keys follow `session:{channel}:{userId}`. A format change would silently break cross-channel session continuity |
| Cache payload schema accepted | The Zod shape used to deserialise a cached response accepts valid data |
| Cache payload schema rejected | Malformed cache entries (missing `text`) are rejected before reaching the UI layer |

**Integration-level tests** (mocked infrastructure):

| Test | What it proves |
|---|---|
| `fromCache: true` on cache hit | When the semantic cache returns a match, `shopAgent.generate` is never called — the O(1) fast path works and avoids unnecessary LLM spend |
| Continues after graph expansion failure | When the 2-hop graph traversal throws (e.g. pgvector extension missing), the orchestrator returns a valid agent response from vector-only context — a graph failure never propagates as a crash |

---

### `tools.test.ts`

Mastra agent tools are the bridge between `shopAgent` and Vendure. Tests cover both their Zod input schema constraints (enforced by the AST firewall) and their execute-level data mapping.

**Schema tests:**

| Test | What it proves |
|---|---|
| Search term accepted | `SearchCatalogInputSchema` accepts a valid 2–150 char term |
| Search term too short rejected | Terms under 2 chars are rejected — prevents embedding noise from single-char queries |
| Product slug accepted | `ExploreProductInputSchema` accepts a valid non-empty slug |
| Empty slug rejected | Empty slug fails validation before a network call is made |

**Execute tests:**

| Test | What it proves |
|---|---|
| `searchCatalogTool` maps Vendure items to product cards | The field mapping from Vendure's `productId`/`productName`/`slug` → storefront's `id`/`title`/`handle` is correct. A broken mapping would cause the UI to render empty concierge results. `runVendureQuery` is mocked via `vi.mock` so no Vendure instance is needed |

---

### `embedding.client.test.ts`

The `getEmbedding` function calls the Gemini `embed-2` API and returns a 768-dim float vector. Every vector similarity search and cache lookup depends on it.

| Test | What it proves |
|---|---|
| Happy path → returns values | Gemini response is parsed and the float array is returned |
| Missing API key → `CONFIG_MISSING` | Fails fast at startup if `EMBEDDING_API_KEY` is not set, not at query time |
| Gemini quota error → `UPSTREAM_API_ERROR` | A 429 / quota-exceeded error from Gemini is surfaced as a typed `IntegrationError` |

---

### `graph-retriever.test.ts`

`expandProductGraph` performs a 2-hop embedding similarity walk: starting from vector-matched seed products, it finds their live variants and semantically related paired products via pgvector.

| Test | What it proves |
|---|---|
| Returns variants and paired products | Given a seed product, the retriever correctly assembles variant rows and paired products from mock pg Pool queries, and `formatGraphContext` includes the related product name |
| Empty seeds → empty result | No seeds produces an empty result immediately without hitting the database |

---

## Design Philosophy

Tests in this suite are deliberately narrow and fast:

- **No real network calls.** All Vendure, Gemini, Redis, and Postgres calls are intercepted via `vi.stubGlobal("fetch", ...)` or `vi.mock(...)`.
- **No shared state between tests.** Each test resets mocks in `afterEach` / `beforeEach`.
- **Failures are typed.** Every expected error is asserted against `code` (e.g. `"UPSTREAM_API_ERROR"`) — not message strings that can drift.

The goal is to prove the AI pipeline's contract at every boundary, not to integration-test against live infrastructure (that is covered by `scripts/eval-rag.ts` and `scripts/test-cache-cycle.ts`).
