---
name: react-orchestration
description: "Use these rules ONLY when building or modifying Mastra Agents, designing workflows, or tuning ReAct tool-calling loops"
---

# Strict Deterministic ReAct Loop Architecture

This skill activates exclusively when writing or configuring autonomous AI workflows, Mastra agents, and tool execution matrices. Do not apply these rules to UI components, GraphQL queries, or CSV seeding tasks.

---

## Rule 1: Ironclad Execution Bounds (The Concurrency Cage)

You are **strictly prohibited** from creating a Mastra agent loop without declaring an explicit, immutable maximum step or recursion depth constraint.

- **Maximum Tool Call Execution Depth:** Hard-locked to a maximum of **5 iterations** per orchestration sequence.
- **The Fallback Mandate:** If the loop reaches step 5 without a definitive result, the agent must cleanly catch the index, abort the tool chain, and route a human-readable triage message to the caller. Never let the loop silently exhaust.

```ts
// ✅ Correct: Hard-bound execution depth natively in the agent config
const shopAgent = new Agent({
  name: 'ShopAgent',
  instructions: `
    You are a shopping assistant. If you cannot resolve the customer request
    within 5 tool calls, respond with a clear escalation message.
    Never retry a failed tool call more than once.
  `,
  model: { provider: 'google', name: 'gemini-1.5-pro' },
  maxSteps: 5, // ponytail: hard ceiling — upgrade to dynamic config if retry policies needed
});

// ✅ Correct: Explicit fallback catch on the execution boundary
const result = await shopAgent.generate(prompt);
if (result.steps.length >= 5 && !result.finishReason === 'stop') {
  return { type: 'escalation', message: 'Unable to resolve your request. A team member will follow up.' };
}
```

```ts
// ❌ Forbidden: Unbounded agent with no step ceiling
const shopAgent = new Agent({
  name: 'ShopAgent',
  instructions: 'Help customers find products.',
  model: { provider: 'google', name: 'gemini-1.5-pro' },
  // No maxSteps — agent can loop indefinitely on tool failures
});
```

---

## Rule 2: Strict Zod Input Structuring for All Tools

Every tool registered to a Mastra agent must have a non-speculative, fully typed Zod input schema. You are barred from passing open-ended string blocks to tools that mutate user state.

- Schema variables must be exported constants ending in `Schema` (e.g. `export const ModifyCartInputSchema`).
- All string inputs must have `.max()` constraints.
- All number inputs must have explicit `.min()` and `.max()` constraints.

```ts
// ✅ Correct: Constrained schema, exported constant, no open-ended fields
export const ModifyCartInputSchema = z.object({
  variantId: z.string().max(64),
  quantity: z.number().int().min(1).max(99),
  action: z.enum(['add', 'remove', 'update']),
});

// ❌ Forbidden: Inline schema with unconstrained string
const modifyCartTool = createTool({
  inputSchema: z.object({ variantId: z.string(), quantity: z.number() }),
  // ...
});
```

---

## Rule 3: Tool Result Pruning (Context Window Hygiene)

Tool results returned to the agent's internal memory space must be passed through a strict data mapper **before** being appended to the context window.

- Strip all database primary IDs (`id`, `_id`, `internalSku`), cost margins, supply chain fields, and system-internal metadata.
- Expose only external-facing, customer-relevant scalar fields (`name`, `slug`, `price`, `stockLevel`).

```ts
// ✅ Correct: Prune tool result before returning to agent context
function pruneVariantForAgent(variant: ProductVariant) {
  return {
    name: variant.name,
    slug: variant.slug,
    priceFormatted: formatPrice(variant.priceWithTax),
    inStock: variant.stockLevel !== 'OUT_OF_STOCK',
  };
  // ponytail: extend with image thumbnail once asset CDN URLs are stable
}
```

---

## Rule 4: Deterministic Tool Routing (No Speculative Branching)

The agent's tool selection must follow a deterministic routing order. You are prohibited from registering tools that have overlapping input signatures or ambiguous descriptions that could cause the LLM to select the wrong tool.

- Each tool's `description` field must be a precise, unambiguous action statement.
- Tools that modify state (`modifyCart`) must be explicitly separated from tools that read state (`searchCatalog`).

| Tool | Type | Description contract |
| ---- | ---- | -------------------- |
| `searchCatalogTool` | Read | "Search the product catalog by keyword. Returns matching product names and slugs." |
| `modifyCartTool` | Write | "Add, remove, or update the quantity of a specific variant in the customer's active cart." |
| `showRecommendationsTool` | Read | "Return up to 3 product recommendations based on a given product slug or category." |
