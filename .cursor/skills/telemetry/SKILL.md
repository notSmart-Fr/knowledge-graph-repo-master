---
name: open-telemetry-governance
description: Enforces structured OpenTelemetry span tracing while guarding sensitive user identifiers.
match_glob: "scripts/worker.ts"
---

# 👁️ OBSERVABILITY INVARIANTS

When instrumenting execution blocks with telemetry tracing:

1. **Span Context Lifecycle:** You must explicitly wrap all external infrastructure boundaries (Database lookups, Queue additions, Model generations) inside a distinct `tracer.startActiveSpan()` execution block.
2. **Data Anonymization:** You are strictly forbidden from recording raw user-identifiable strings (like raw phone numbers, customer names, or chat text bodies) as attributes on public spans. Use hashed identifiers or generic system metadata tags only.
