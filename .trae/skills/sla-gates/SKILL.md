---
name: sla-gates
description: >-
  Implements the AI CRM SLA gates pipeline: DeepEval RAG triad evaluation (golden dataset), P95 latency bounds, Grafana Cloud budget ceilings, operational SLA gates, and the pre-commit validate script.
---

# SLA Gates

## RAG Triad Evaluation (DeepEval)
- **Golden dataset**: 50 examples total:
  - 20 WhatsApp (mixed text/structured queries)
  - 15 voice (transcript fragments)
  - 15 mixed (voice-to-whatsApp handoff)
- **Thresholds**: Faithfulness ≥ 0.90, Answer Relevancy ≥ 0.85, Context Precision ≥ 0.85
- **Runner**: `scripts/eval-rag.ts`, output: `scripts/eval-results.json`
- **Metrics tracked**: `rag_triad.faithfulness`, `rag_triad.answer_relevancy`, `rag_triad.context_precision`

## P95 Latency Bounds
- **WhatsApp webhook**: < 2.0 s
- **Voice pipeline**: < 1.5 s
- **Cold cache (no embeddings/Neo4j)**: < 3.0 s
- **Cache hit**: < 200 ms
- **Graph traversal**: < 500 ms
- **Embedding API call**: < 1.0 s

## Telemetry Budget Ceilings (Grafana Cloud Free Tier)
- **Active metrics**: ≤ 2000 series (of 10 000 free)
- **Trace volume**: ≤ 5 GB/month (of 50 GB free; use 10 % head‑based sampling)
- **Log volume**: ≤ 2 GB/month (WARN + only, structured JSON, no stack traces)
- **Collection interval**: 60 s (configured in `config/otel-bootstrap.ts`)
- **Spans per request**: ≤ 8 (1 per orchestrator step)
- **Budget alerts**: 80 % → WARN log; 95 % → ERROR log + page via Grafana

## Operational SLA Gates
- **Cache hit rate**: ≥ 30 % (warn on 25 %, fail on 20 %)
- **Idempotency hit rate**: ≤ 5 % (warn on 10 %)
- **Circuit breaker open**: < 60 s consecutive per adapter
- **DLQ depth**: < 50 items/queue (warn on 40, fail on 50)
- **AI generation failure rate**: < 5 % (warn on 3 %, fail on 5 %)
- **/ready endpoint**: < 500 ms (warn on 400 ms, fail on 500 ms)

## Pre-Commit Pipeline: `bun run validate`
Runs all checks and outputs `scripts/validate-results.json`, fails (exit 1) if any gate breached:
1. **RAG triad check**: runs `scripts/eval-rag.ts` against golden dataset
2. **Latency benchmark**: simulates 100 WhatsApp requests, 50 voice requests, checks P95 bounds
3. **Metric ceiling check**: simulates traffic for 5 min, checks no metric exceeds 2000 active series
4. **Operational SLA check**: simulates normal operation, checks all operational gates pass
5. **AST firewall check**: runs `bun check`

## Reference
See spec **Section V (Quantifiable SLA Gates)** for full details.
