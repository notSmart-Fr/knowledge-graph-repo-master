---
name: storefront-routing
description: "Use these rules ONLY when editing Remix routes, presentation components, forms, or client-side layout files under apps/storefront/app/routes/"
---

# Blueprint: Remix Routing & Data Isolation Layer

## Layer Decoupling & BFF Architecture (Rule 1)

1. GraphQL Isolation Gate: Files inside the routing wire layout are strictly prohibited from directly importing core database engines, NestJS configurations, or backend models. All data operations must route securely through the central GraphQL client abstraction (`~/lib/graphql-client`) or Mastra workflows.
2. Network Flood Throttling: Avoid raw, un-debounced client-side `onChange` listeners that fire backend actions rapidly. Use Remix native `<Form>` blocks or manage submissions using a structured, debounced `useSubmit()` helper to prevent query flooding.
3. Over-Fetching Limits (Level 3 Determinism): Collection query listings target scalar parameters exclusively (`id`, `name`, `slug`). Heavy media matrices, full descriptive sheets, and variation arrays must be deferred to explicit detail views.
