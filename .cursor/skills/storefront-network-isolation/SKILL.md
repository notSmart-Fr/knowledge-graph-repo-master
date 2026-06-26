---
name: storefront-network-isolation
description: "Use these rules ONLY when modifying, writing, or querying network interfaces, fetch layers, or Zod schemas in apps/storefront/"
match_glob: "apps/storefront/app/**/*.{ts,tsx}"
---

# Storefront Network Isolation: Systemic Boundary Invariants

You are operating within an environment monitored by a local out-of-band AST structural compiler firewall (`scripts/ast-firewall.ts`). Every file save event mathematically verifies your syntax nodes against these structural rules. Code that violates these nodes will fail compilation immediately.

## 1. The Serialization Perimeter (Anti-Data Drift)

- You are strictly forbidden from directly consuming raw unvalidated JSON objects returned by any network call node (`fetch`, `axios`, `http.get`, `http.post`).
- EVERY resolution path of a network payload MUST be explicitly wrapped inside a structural Zod schema validation node (`Schema.parse()`, `Schema.parseAsync()`, or `Schema.safeParse()`).
- The parser node must execute at the absolute perimeter interface before any data properties are mapped into the internal application layout or state.

## 2. The Distributed State Contract (Partial-Failure Prevention)

- Every outbound state-mutating network call node (`.post()`, `.put()`, `.patch()`, or a `fetch()` call configured with a mutating HTTP method) must pass a structured configuration object.
- The configuration block MUST contain a nested `headers` object literal declaration.
- The `headers` literal node MUST explicitly declare an `'Idempotency-Key'` (or `"Idempotency-Key"`) property assigned to a unique client-generated UUID string token.

## 3. Error Blast Radius Containment (Graceful Degradation)

- All network execution blocks must be enclosed inside a deterministic `try/catch` block.
- The `catch` block must explicitly isolate `z.ZodError` nodes to handle schema mismatches separately from standard network dropouts, forcing a safe, predictable UI fallback state array or primitive rather than allowing runtime unhandled rejections.
