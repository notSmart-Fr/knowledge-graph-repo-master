---
name: rag-pipeline
description: "Use these rules ONLY when building semantic search features, writing database vector chunking scripts, or hooking up context retrieval utilities"
---

# High-Fidelity RAG Context Retrieval Protocol

This skill activates exclusively for tasks involving vector embeddings, content tokenization, similarity search queries, and injecting semantic retrieval results into the storefront. Do not apply these rules to UI components, Mastra agent loops, or commerce cart mutations.

---

## Rule 1: Mandatory Pre-Chunk Sanitization

Before a product description, sizing guide, or catalog asset is converted into a vector embedding and pushed to the indexing store, you must sanitize the raw text.

**Strip all of the following before embedding:**

- Raw HTML or Markdown fragments (`<div>`, `**bold**`, `###`, `---`)
- Trailing structural symbols and whitespace artifacts
- Internal commerce metadata fields: cost price, supplier names, internal SKU codes, warehouse IDs
- System prompt fragments or any text prefixed with roles (`SYSTEM:`, `ASSISTANT:`)

**Permitted vector payload fields (natural, external-facing text only):**

| Field | Permitted |
| ----- | --------- |
| `product.name` | ✅ Yes |
| `product.description` (sanitized) | ✅ Yes |
| `variant.options` (e.g. "Size: Medium") | ✅ Yes |
| `product.costPrice` | ❌ No — internal |
| `product.supplierCode` | ❌ No — internal |
| `order.internalNotes` | ❌ No — internal |

```ts
// ✅ Correct: Strip internal fields and HTML before embedding
function sanitizeForEmbedding(product: ProductDetail): string {
  const rawDescription = product.description ?? '';
  const cleanDescription = rawDescription
    .replace(/<[^>]+>/g, '')       // strip HTML tags
    .replace(/[#*`_~>|]/g, '')    // strip markdown symbols
    .trim();
  // ponytail: add profanity/PII filter pass once moderation API is integrated
  return `${product.name}. ${cleanDescription}`;
}
```

---

## Rule 2: Batched Embedding Execution (Concurrency Gate)

You are **strictly prohibited** from wrapping an embedding function directly inside an unthrottled `Promise.all` map. This will exhaust API rate limits instantly on large catalogs.

- Chunk input arrays into batches of **≤ 20 items** before embedding.
- Use a sequential loop or a controlled concurrency utility between batches.

```ts
// ✅ Correct: Batch into chunks of 20 before embedding
async function embedProductBatch(products: SanitizedProduct[]) {
  const BATCH_SIZE = 20;
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(p => vectorStore.upsert(p.id, p.text)));
    // ponytail: add configurable delay here once rate limit tier is confirmed
  }
}

// ❌ Forbidden: Unthrottled full-array embed
await Promise.all(products.map(p => vectorStore.upsert(p.id, embed(p.text))));
```

---

## Rule 3: The Output-Sanitization Gateway

You are **completely blocked** from piping a raw RAG retrieval payload directly into the chat stream response or into any client-facing component.

Every vector similarity search result must pass through the `validateAndFilterOutput` utility module before reaching the stream or the UI.

**Enforcement chain:**

```text
vectorStore.similaritySearch(query)
  → validateAndFilterOutput(rawResults)   ← MANDATORY GATE
  → inject into agent context / stream
```

```ts
// ✅ Correct: All retrieved context passes through the sanitization gate
const rawContext = await vectorStore.similaritySearch(userQuery, { topK: 5 });
const sanitizedContext = validateAndFilterOutput(rawContext);
// Only now pass to the agent or stream response

// ❌ Forbidden: Raw retrieval piped directly to the stream
const context = await vectorStore.similaritySearch(userQuery, { topK: 5 });
return streamText({ model, prompt: `${context}\n\nUser: ${userQuery}` });
```

---

## Rule 4: Similarity Search Result Shape Contract

The object returned from any `similaritySearch` call must be mapped to a strict, typed DTO before injection into agent context. Never pass raw database records.

```ts
// ✅ Correct: Map to a clean DTO before use
interface RetrievedChunk {
  text: string;          // External-facing natural language only
  productSlug: string;   // Safe for routing links
  score: number;         // Similarity confidence (0–1)
}

function mapToRetrievedChunk(raw: VectorRecord): RetrievedChunk {
  return {
    text: raw.payload.sanitizedText,
    productSlug: raw.payload.slug,
    score: raw.score,
  };
  // ponytail: add score threshold filter (e.g. score > 0.75) once baseline is measured
}
```
