---
name: backend-orchestration
description: "Use these rules ONLY when modifying, creating, querying, or structuring Mastra tools, schemas, and GraphQL data layers in domains/"
---

# Blueprint: Core Domain Data & Mastra Tooling Contract

## Schema Parameter Restrictions (Rule 2 / Rule 13)

When creating or modifying an input schema constant (any object declaration matching the suffix `*Schema`, such as `ModifyCartInputSchema`), you must enforce explicit validation constraints:

1. Strings: Must explicitly chain upper size limits using `.max()`.
2. Quantities & Prices: You are strictly forbidden from passing floating-point configurations for monetary values or inventory parameters. All financial values must be handled as atomic integers representing minor sub-units (e.g., cents). Numeric variables must chain `.int().positive()`.
3. Inventory Overage Protection: Any field tracking cart item quantities must enforce a strict constraint limit of `.max(99)`.
4. State Idempotency: All state-mutating checkout or cart modification tools must require a unique, client-generated tracking parameter: `idempotencyKey: z.string().uuid()`.
5. Price-Tampering Defense: Backend tools must calculate item totals based on verified database price matrix lookups. Do not accept client-side pricing values as parameter fields within tool inputs.
