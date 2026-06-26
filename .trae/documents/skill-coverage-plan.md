# Plan: Fill Skill Coverage Gaps

## Summary
Create 2 missing skills (UI Dashboard, SLA Gates) and patch 3 existing skills (deployment-health, graceful-degradation, spec.md reference) to achieve full spec-to-skill coverage.

## Phase 1: Create Missing Skills

### Step 1: Create `ui-dashboard/SKILL.md`

**Why:** Pillar 4a (~100 lines of spec) has no skill. The agent has no guidance for building the Vite + Vanilla TS dashboard.

**Content to include:**
- YAML frontmatter: `name: ui-dashboard`, description covering Vite + Vanilla TS + Motion One dashboard
- **Stack:** Vite 6+, Vanilla TypeScript, Motion One 4.x (3KB), CSS custom properties + @container queries, EventTarget-based store
- **Layout:** Pure black (#000) CSS Grid — 65/35 asymmetrical split, 80px bottom contact bar
- **Zones:** Transcript Stream pane, Metrics Sidebar (4 magnetic cards), Contact Context Bar
- **Magnetic Card:** cursor proximity → `rotateX/rotateY` (±12deg max), Motion One animate(), `perspective: 800px`, `will-change: transform`, hover-gated via `matchMedia("(hover: hover)")`
- **Radar Glow:** `::before` pseudo-element with `radial-gradient` tracked via `--cursor-x`/`--cursor-y` CSS custom properties, `rgba(255,255,255,0.06)`, `pointer-events: none`
- **Data sources** (read-only): Supabase Realtime (WebSocket), LiveKit transcript stream, `GET /ready` port 8280, OTel Prometheus endpoint
- **State:** EventTarget store pattern — no Redux/Zustand/signals
- **Degradation:** Each data panel shows dimmed "data unavailable" state when source fails, no spinners, no modals
- Reference the spec Section Pillar 4a

### Step 2: Create `sla-gates/SKILL.md`

**Why:** Section V (SLA gates) has no skill. The agent has no guidance for RAG evaluation, latency bounds, telemetry budgets, or the pre-commit validate pipeline.

**Content to include:**
- YAML frontmatter: `name: sla-gates`, description covering RAG evaluation, P95 bounds, telemetry ceilings, pre-commit pipeline
- **RAG Triad:** DeepEval on 50-example golden dataset (20 WhatsApp, 15 voice, 15 mixed)
  - Faithfulness ≥ 0.90, Answer Relevancy ≥ 0.85, Context Precision ≥ 0.85
  - Runner: `scripts/eval-rag.ts`, output: `scripts/eval-results.json`
- **P95 Latency Bounds:** WhatsApp < 2.0s, Voice < 1.5s, Cold cache < 3.0s, Cache hit < 200ms, Graph traversal < 500ms, Embedding API < 1.0s
- **Telemetry Budget Ceilings:** Grafana Cloud free (50GB traces, 10K metrics)
  - Our ceilings: 2000 metric series, 5GB traces/month, 2GB logs/month, 60s collection interval
  - Budget alerts: 80% = WARN, 95% = ERROR + page
- **Operational SLA Gates:** Cache hit ≥ 30%, Idempotency hit ≤ 5%, No breaker open > 60s, DLQ depth < 50, AI failure rate < 5%, /ready < 500ms
- **Pre-Commit Pipeline:** `bun run validate` → RAG triad + latency + metric ceiling + SLA gate checks → `scripts/validate-results.json`
- Reference spec Section V

## Phase 2: Patch Existing Skills

### Step 3: Patch `deployment-health/SKILL.md` — Add Telemetry Budget Section

**What to add:** New subsection after the Env Schema section:

```md
## Telemetry Budget (Grafana Cloud Free Tier)

**Ceilings (to stay under free tier limits):**
- **Active metrics:** ≤ 2000 series (of 10,000 free)
- **Trace volume:** ≤ 5 GB/month (of 50 GB free, head-based sampling at 10%)
- **Log volume:** ≤ 2 GB/month (WARN+ only, structured JSON, no stack traces)
- **Collection interval:** 60s (configured in `config/otel-bootstrap.ts` via `PeriodicExportingMetricReader`)
- **Spans per request:** ≤ 1 per orchestrator step (8 spans/request max, firewall Rule 14)

**Budget alerts:**
- `crm.telemetry.metrics_active` gauge — current active metric series count
- `crm.telemetry.traces_bytes` counter — monthly trace data volume
- 80% ceiling → WARN log. 95% ceiling → ERROR log + page.
```

Also add `OTEL_SERVICE_NAME` to the env schema: `OTEL_SERVICE_NAME: z.string().default("ai-crm")`.

### Step 4: Patch `graceful-degradation/SKILL.md` — Add Circuit Breaker Telemetry + SLA Links

**What to add:** After the Circuit Breaker configuration section:

```md
## Circuit Breaker Telemetry

OTel metric `crm.circuit_breaker.state` (gauge) — per-adapter state:
- `0` = closed, `1` = half-open, `2` = open

Exposed via `/ready` endpoint. Health dashboard polls this gauge.

## SLA Gate Links

These operational SLA gates (defined in `sla-gates` skill) monitor degradation:
- No circuit breaker open for > 60s → otherwise fallback is running
- AI generation failure rate < 5% → otherwise DeepSeek fallback is overloaded
- DLQ depth < 50 items/queue → otherwise systematic failure
- Cache hit rate ≥ 30% → otherwise embeddings too dissimilar
```

### Step 5: Patch `spec.md` Line 520 — Stale Reference

**What:** Line 520 says:
```
bun check           # 15-rule AST firewall. Exit 1 = blocked.
```

**Change to:**
```
bun check           # 19-rule AST firewall. Exit 1 = blocked.
```

## Verification

1. `ls .trae/skills/` shows 8 directories (6 existing + 2 new)
2. All 6 spec pillars + Section V have at least one skill covering them
3. `grep -r "15-rule" .trae/specs/` returns only the line we patched (now says 19)
4. `deployment-health` env schema includes `OTEL_SERVICE_NAME`
5. `graceful-degradation` references `crm.circuit_breaker.state` gauge
