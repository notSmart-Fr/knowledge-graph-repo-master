---
name: "archguard-implement"
description: "Writes/merges ESLint config, ArchUnit tests, and whitelist files from the archguard plan. Invoke LAST in the archguard pipeline, after archguard-plan."
---

# ArchGuard Implement

Phase 5 of the architectural guard generator. Reads the plan and writes the actual config files, ArchUnit tests, and whitelist files. Merges with existing configs if present.

## Pipeline Position

```
archguard-discover → archguard-clarify → archguard-plan → archguard-implement
                                                                     ↑ You are here
```

## Prerequisites

- `.archguard/plan.md` must exist.
- Existing `eslint.config.*` and `tests/architecture.test.ts` should be read first (if they exist) to understand what's already in place.

## Procedure

### Step 1: Read existing configs

Check what already exists:
- `eslint.config.js`, `eslint.config.mjs`, `eslint.config.cjs`
- `tests/architecture.test.ts`
- `tsconfig.json` (or `tsconfig.base.json`)

### Step 2: Write ESLint config

Merge plan rules into ESLint config. If config exists, preserve existing rules and add new ones. If not, create the file.

Format: **Flat config (eslint.config.cjs)** — `module.exports = [...]`

Rules to write:
- All ESLint rules from the plan
- Ensure `@typescript-eslint/no-explicit-any: "error"` is included (FM2 type safety)
- Ensure `@typescript-eslint/no-floating-promises: "error"` is included (FM5)
- Ensure `@typescript-eslint/ban-ts-comment` is included (FM2 type safety)

For each `no-restricted-syntax` entry:
```js
{
  selector: "...",
  message: "...",
}
```

### Step 3: Write ArchUnit tests

Merge plan rules into `tests/architecture.test.ts`. Preserve existing tests, add new ones.

Each rule:
```typescript
it('RULE NAME', async () => {
  const rule = projectFiles()
    .inFolder('PATH')
    .shouldNot()
    .dependOnFiles()
    .inFolder('OTHER_PATH');
  await expect(rule).toPassAsync();
});
```

### Step 4: Update tsconfig.json

Add/verify these compiler options:
```json
{
  "compilerOptions": {
    "useUnknownInCatchVariables": true,
    "strict": true
  }
}
```

Add `@typescript-eslint` parser options to `.vscode/settings.json` or eslint config for type-aware rules.

### Step 5: Create whitelist files

For each whitelist file in the plan marked "to create":
- Create the directory if needed
- Write the file with a skeleton implementation and a comment block:

```typescript
/**
 * SAFE FETCH — the ONLY place fetch() is allowed.
 * Wraps native fetch with: Zod parsing, AbortSignal timeout, circuit breaker.
 *
 * DO NOT call fetch() directly anywhere else. ESLint will block it.
 */
export async function safeFetch<T>(...) { ... }
```

### Step 6: Verify

After writing all files:
1. Run `pnpm lint` (or `eslint . --ext .ts,.tsx`) to verify ESLint config is valid.
2. Run `pnpm test:arch` (or `vitest run tests/architecture.test.ts`) to verify ArchUnit tests pass.
3. Report any failures.

### Step 7: Write summary

```
├── eslint.config.cjs          (N rules: X new, Y existing)
├── tests/architecture.test.ts  (M tests: A new, B existing)
├── tsconfig.json               (updated: [list changes])
├── Whitelist files created:    [list]
└── .archguard/plan.md          (plan executed)
```

## Constraints

- **Merge, don't replace.** If eslint.config or architecture.test exists, add to it — never delete existing rules.
- **Test after writing.** Run lint + test:arch immediately. If they fail, fix before reporting done.
- **Use `.cjs` extension** for ESLint flat config if the project has `"type": "module"` in package.json. This avoids ESM/CJS conflicts.
- Do not install new npm packages unless the plan explicitly requires them (e.g., `archunit`, `@typescript-eslint/eslint-plugin`).
