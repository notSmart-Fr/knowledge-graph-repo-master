---
name: multi-modal-normalization
description: Enforces the architectural flattening of messy media arrays into uniform text primitives.
match_glob: "scripts/worker.ts"
---

### 🎛️ DATA FLATTENING INVARIANTS

When handling media attributes or multi-modal payloads inside our background queue worker:

1. **Primitive Uniformity:** You must map all raw incoming media types (audio links, image buffers, unstructured JSON tables) into a single, unified text schema shape (`{ normalizedText: string }`).
2. **Boundary Isolation:** Downstream extraction prompts or processing scripts are strictly forbidden from inspecting raw binary objects or handling file media directly. They must consume only the flattened string output.
