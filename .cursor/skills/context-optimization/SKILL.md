---
name: context-window-optimization
description: Enforces structured prompt composition layouts to maximize infrastructure-level context caching.
match_glob: "apps/storefront/app/domains/ai-agents/**/*.ts"
---

### 🧠 PROMPT LIFECYCLE INVARIANTS

When assembling prompt strings or system instructions for our language model layers:

1. **Prefix Invariance:** All static configurations, behavioral instructions, and structured output schemas MUST be grouped continuously at the absolute prefix of the prompt.
2. **Volatile Appending:** Unpredictable or changing runtime values (like user text message primitives) MUST only be appended at the absolute tail/suffix of the final prompt evaluation block.
