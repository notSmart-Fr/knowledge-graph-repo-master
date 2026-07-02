# Universal Project Constitution

> **Template for speckit-constitution.** Replace all `[PROJECT-SPECIFIC]` blocks with your project's actual values. The 12 Core Principles (1.1–1.12) are universal and should not be removed. All other sections may be tuned per project.

---

## 1. Core Principles (Universal — Do Not Modify)

### 1.1 Separation of Concerns

Every piece of code has ONE responsibility and ONE reason to change. Modules that try to do multiple things become impossible to test, refactor, or reason about.

### 1.2 Dependency Direction

Dependencies point INWARD toward stable, core business logic. Outer layers depend on inner layers. Never the reverse. Core logic imports nothing from infrastructure or frameworks.

### 1.3 Testability First

Core business logic MUST be testable without mocks, frameworks, or external dependencies. Logic that would cause data loss, security violations, or incorrect business outcomes if broken MUST be tested. Coverage is a lagging indicator, not a target.

#### 1.3.1 Determinism in Core Logic

Core business logic MUST be deterministic. Non-deterministic primitives (`Date.now()`, `Math.random()`, `crypto.randomUUID()`) MUST NOT be called directly in Core. Inject them via abstractions (e.g., `Clock`, `IdGenerator`) so tests can control time and randomness deterministically.

**Why:** Dijkstra (1972): "Program testing can show the presence of bugs, never their absence." Non-deterministic logic makes test results irreproducible, defeating the purpose of testing.

### 1.4 Type Safety

All code MUST use strict typing. Type escapes (`any`, `@ts-ignore`, `@ts-nocheck`) are FORBIDDEN except for documented exceptions in legacy migration contexts. Exported functions and public API surfaces MUST have explicit return types. Internal functions may rely on inference.

### 1.5 Observability by Default

All critical paths MUST be instrumented. Errors MUST be traceable to their source. Structured logging (JSON) with trace IDs is preferred over unstructured console output.

### 1.6 Fail Gracefully

All external calls (network, database, file I/O) MUST have timeouts. No unhandled exceptions — every catch block must log, rethrow, or degrade. Recovery paths (retry, fallback, circuit breaker) should be explicit and configurable.

### 1.7 Data Integrity

All data entering the system from external sources MUST be validated at the boundary before reaching internal logic. All data leaving the system MUST be validated or sanitized. Invalid data MUST NOT enter Core.

### 1.8 Idempotency

External write operations that can be retried MUST be idempotent. Retry mechanisms SHALL use idempotency keys with a defined TTL for distributed systems. Local/embedded operations may skip idempotency if retry is not possible.

### 1.9 Backward Compatibility

Public APIs, schemas, and data formats SHALL be backward-compatible within a major version. Breaking changes follow: deprecation → grace period → removal. Internal-only interfaces may break freely.

### 1.10 Resource Lifecycle (FM5)

All acquired external resources (connections, streams, file handles, timers) MUST have guaranteed teardown via `try/finally`, `using` (explicit resource management), or equivalent deterministic cleanup. Ungraceful process termination (`process.exit`) is FORBIDDEN — use structured shutdown handlers (`SIGTERM`, `SIGINT`) to drain connections before exit.

**Why this is universal:** Every program that touches OS resources must clean them up. This is a physical law of resource-constrained systems, not an architectural opinion.

### 1.11 State Sanitization (FM3)

Sensitive data (PII, secrets, tokens, internal identifiers, raw domain models) MUST NOT appear in logs, error messages, telemetry spans, or API response bodies unless explicitly redacted or mapped to a safe DTO. Logs are permanent. Never log what you cannot explain.

**Why this is universal:** Every system produces logs. Every system has some form of sensitive data. Leaking internal state to outputs is a universal failure mode, regardless of codebase age or size.

### 1.12 Transaction Integrity (FM6)

Any function executing multiple dependent write operations (updates, inserts, deletes on related entities) MUST wrap them in an atomic transaction or distributed saga. Partial writes corrupt system state. Idempotency (1.8) prevents duplicate writes; atomicity (1.12) prevents partial writes. Both are required when mutating shared state.

**Why this is universal:** Even a CLI tool writing to a local SQLite file must be atomic if it updates two tables. This is a fundamental property of state mutation, not a microservices concern.

#### 1.12.1 In-Memory State

Shared in-memory state (caches, counters, registries at module scope) MUST be encapsulated in dedicated state-owning services with explicit lifecycle hooks. Module-level `let`/`var` declarations are FORBIDDEN. All shared state SHALL be passed explicitly through function parameters or managed by a service with well-defined concurrency semantics.

**Why:** Lamport (1978): shared mutable state in concurrent systems produces non-deterministic failures. Even in single-threaded async runtimes, interleaved `await` points create race conditions on module-level state that no unit test will reproduce.

---

## 2. Architecture

[PROJECT-SPECIFIC] — Define your architecture here. The 12 Core Principles apply regardless of your choice.

Common patterns to select from:
- **Hexagonal / Ports & Adapters** — SaaS, microservices, enterprise apps with multiple external dependencies
- **Layered (MVC)** — Traditional web apps, monoliths with clear UI/Logic/DB split
- **Pipeline (ETL)** — Data workflows, batch jobs, stream processors
- **Module / Plugin** — CLI tools, extensible libraries, SDKs
- **Single-File / Lambda** — Serverless functions, one-off scripts

Describe:
- Your chosen pattern and why it fits
- Layer names and their responsibilities
- A dependency diagram showing what can import from what
- Any exceptions to the Dependency Direction principle (1.2)

### 2.1 Dependency Rules

[PROJECT-SPECIFIC] — Define which imports are allowed and banned between your layers.

```
✅ [allowed direction]
❌ [banned direction]
```

---

## 3. Quality Gates

### 3.1 Type Safety

| Rule | Requirement |
|------|-------------|
| TypeScript strict mode | `"strict": true` in tsconfig.json |
| No `any` types | ZERO allowed (use `unknown` instead) |
| No `@ts-ignore` / `@ts-nocheck` | ZERO allowed |
| Exported functions have explicit return types | Required |
| Public APIs have explicit parameter types | Required |
| Internal functions may rely on inference | Allowed |
| `catch` variable type | `unknown` (enforced by `useUnknownInCatchVariables`) |

### 3.2 Architecture Boundaries

[PROJECT-SPECIFIC] — Define per-layer constraints based on your architecture choice.

| Rule | Requirement |
|------|-------------|
| Core defines abstractions only | Core has no implementation of external systems |
| Adapters implement Core abstractions | Adapters wrap external systems |
| Application uses abstractions, not implementations | Application doesn't know about specific adapters |
| [Add project-specific boundaries here] | |

### 3.3 Testing

| Priority | What to Test |
|----------|--------------|
| CRITICAL | Business logic that would cause data loss if broken |
| CRITICAL | Security validation and authorization |
| HIGH | Error handling and recovery paths |
| HIGH | Idempotency of write operations |
| MEDIUM | Adapter implementations (integration tests) |
| MEDIUM | Application workflows |
| LOW | UI component rendering |

### 3.4 Error Handling

| Rule | Requirement |
|------|-------------|
| No empty catch blocks | All catch blocks log or rethrow |
| All external calls have timeouts | Timeout parameter or AbortSignal present |
| External write operations idempotent | Idempotency key pattern used (if distributed) |
| Custom error types for domain errors | Errors extend base Error class |
| All errors have context | Structured metadata included in error logs |

### 3.5 Observability

| Rule | Requirement |
|------|-------------|
| All errors logged (with context) | Context includes trace ID where available |
| All external calls logged | Request/response or outcome logged |
| Critical state transitions logged | State changes logged at appropriate level |
| Log format | Structured JSON preferred |

### 3.6 Data Integrity

| Rule | Requirement |
|------|-------------|
| All external data validated at boundary | Schema validation before entering Core |
| Runtime validation library used | Zod, Yup, or equivalent |
| Types inferred from schemas | Types derived, not manually duplicated |
| Unknown fields rejected | Strict validation mode |
| Validation errors logged | Invalid data logged with context |

### 3.7 Code Hygiene

| Rule | Requirement | Justification |
|------|-------------|---------------|
| Cyclomatic complexity | ≤ 10 per function | McCabe (1976) — defect density threshold |
| Nesting depth | ≤ 3 | Cognitive load ceiling; Pyramid of Doom avoidance |
| Function length | ≤ 75 lines (soft, warn only) | Lipow (1982) — defect density accelerates after 100 lines |
| Unused code | Zero unused exports, variables, files | Knip + `@typescript-eslint/no-unused-vars` |
| Wildcard exports | `export *` FORBIDDEN | Parnas (1972) — intentional public API surfaces only |
| Risk index | ≤ 60 | `(Complexity × Lines) / 10` — NASA/JPL validated threshold |

---

## 4. Timeout Standards (Tune Per Project)

[PROJECT-SPECIFIC] — Define timeouts per external dependency. Default values should be ENV-configurable.

| Context | Default Timeout | Retries | Fallback |
|---------|----------------|---------|----------|
| External HTTP call | `[ENV]` (e.g., 10s) | [count] | [strategy] |
| Database query | `[ENV]` (e.g., 5s) | [count] | [strategy] |
| AI/LLM call | `[ENV]` (e.g., 30s) | [count] | [strategy] |
| User-facing action | `[ENV]` (e.g., 30s) | None | Show error |
| [Add per-adapter entries] | | | |

Circuit breaker: [PROJECT-SPECIFIC — N failures → open S seconds → half-open probe]

### 4.1 Idempotency Standards (Tune Per Project)

[PROJECT-SPECIFIC] — Define idempotency requirements per operation type.

| Context | Idempotency Key Source | TTL |
|---------|----------------------|-----|
| HTTP POST/PUT | `idempotency-key` header | [duration] |
| Message queue writes | `messageId` or equivalent | [duration] |
| Local operations | May skip if retry is impossible | N/A |

---

## 5. Naming Conventions

[PROJECT-SPECIFIC] — Adapt conventions to your chosen architecture. These are defaults.

### 5.1 File Naming

| File Type | Pattern | Examples |
|-----------|---------|----------|
| Core logic | `*.ts` | `SeqBuffer.ts`, `OrderCalculator.ts` |
| Ports / interfaces | `*.port.ts` | `LoggerPort.ts`, `MessageSenderPort.ts` |
| Adapters | `*.adapter.ts` | `WebSocketAdapter.ts`, `PostgresAdapter.ts` |
| Types | `*.types.ts` | `Message.types.ts` |
| Schemas | `*.schema.ts` | `Order.schema.ts` |
| Config | `*.config.ts` | `websocket.config.ts` |
| Constants | `*.constants.ts` | `Protocol.constants.ts` |
| Unit tests | `*.test.ts` | `errors.test.ts` |
| Integration tests | `*.integration.test.ts` | `websocket.integration.test.ts` |

### 5.2 Type/Interface Naming

| Pattern | When to Use | Examples |
|---------|-------------|----------|
| `*Port` | Interfaces defined by Core | `LoggerPort`, `DataStorePort` |
| `*DTO` | Data Transfer Objects | `MessageDTO`, `ToolCallDTO` |
| `*Error` | Custom errors | `ProtocolError`, `TimeoutError` |
| `*Schema` | Validation schemas | `MessageSchema` |
| `*Event` | Domain events | `OrderPlacedEvent` |

### 5.3 Function Naming

| Prefix | Meaning | Side Effects |
|--------|---------|--------------|
| `get*`, `find*` | Pure query | NO |
| `fetch*`, `send*` | External call | YES |
| `create*` | Factory / constructor | NO |
| `handle*` | Event / message handler | YES |
| `validate*` | Validation | NO (returns boolean or throws) |
| `is*` | Boolean predicate | NO |
| `calculate*` | Computation | NO |
| `parse*` | Deserialization | NO |
| `serialize*` | Serialization | NO |

### 5.4 Test Naming

| Pattern | Example |
|---------|---------|
| `should [expected] when [condition]` | `should process messages in order when out-of-order` |
| `should not [expected] when [condition]` | `should not duplicate messages when duplicates received` |

---

## 6. Error Handling

### 6.1 Error Hierarchy (Template)

```
Error
├── DomainError         // Business logic errors
│   ├── ValidationError // Invalid data
│   ├── StateError      // Invalid state transition
│   └── BusinessRuleError
├── SystemError         // Technical errors
│   ├── ConnectionError // Network/socket failures
│   ├── TimeoutError    // Operation timed out
│   └── ExternalError   // External system failure
└── FatalError          // Unrecoverable
    ├── ConfigurationError
    └── InternalError
```

### 6.2 Error Handling Rules

| Rule | Implementation |
|------|---------------|
| All errors must be typed | Custom error classes extending Error |
| All errors must be logged | Logger.error(error, context) |
| Never swallow errors | No empty catch blocks |
| Always provide context | Add identifiers to error metadata |
| Fail fast in Core | Throw DomainError immediately |
| Retry gracefully in Adapters | Retry with configurable backoff |
| Show safe messages to users | Translate errors, strip internals (1.11) |

---

## 7. Observability

### 7.1 Log Levels

| Level | When to Use |
|-------|-------------|
| **ERROR** | System failures, crashes requiring attention |
| **WARN** | Recoverable errors, timeouts, fallback activations |
| **INFO** | State changes, external calls, user actions |
| **DEBUG** | Development details, fine-grained state traces |

### 7.2 Required Logs

| What to Log | Level |
|-------------|-------|
| Application start/stop | INFO |
| External connection attempts | INFO |
| External connection failures | WARN |
| All errors | ERROR |
| State transitions | DEBUG |
| User actions | INFO |
| Idempotency key usage | DEBUG |

### 7.3 Log Format

Structured JSON is preferred:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "INFO",
  "message": "Order processed",
  "context": { "orderId": "ord-123" },
  "traceId": "trace-xyz"
}
```

Never include PII or secrets in log context (principle 1.11).

---

## 8. Documentation Requirements (Tiered)

| Project Type | Minimum Documentation |
|--------------|----------------------|
| **All projects** | `README.md` |
| **Multi-contributor** | `README.md`, `CONTRIBUTING.md` |
| **Public / consumed by others** | `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, Architecture decisions doc |

---

## 9. Quality Gates Pipeline

[PROJECT-SPECIFIC] — Define your pre-commit and pre-merge validation.

### Pre-Commit (Fast, blocks commit)

```
[project check command]    # Architectural guards (ESLint + ArchUnit)
[project test command]     # Unit + contract tests — 0 failures
```

### Pre-Merge (Slower, blocks merge)

```
[project validate command] # Integration checks, SLA gates, RAG evaluation
```

### Operational SLA Gates (if applicable)

[PROJECT-SPECIFIC] — Define performance/correctness thresholds.

| Metric | Threshold | Window |
|--------|-----------|--------|
| [Metric name] | [Value] | [Rolling period] |

---

## 10. Governance

This constitution supersedes all other project practices and conventions. Any deviation from a constitutional principle MUST be documented with justification.

### Amendment Procedure

1. Propose change with justification
2. Review against all 12 Core Principles for regressions
3. Update constitution version (MAJOR: principle change, MINOR: new section, PATCH: clarification)
4. Propagate changes to dependent artifacts (plan, spec, tasks)
5. Re-validate existing features against amended constitution

### Compliance

- Every feature branch MUST pass pre-commit gates
- Every merge to main MUST pass pre-merge gates
- Constitution violations discovered post-merge SHALL be treated as P1 bugs

### Version

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | [DATE] | Initial adoption |

**Approved By:** [TEAM]

**Effective Date:** [DATE]
