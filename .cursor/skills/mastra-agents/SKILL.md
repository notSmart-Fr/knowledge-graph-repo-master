---
name: mastra-agents
description: >-
  Defines the Mastra agent definitions, tool contracts, and agent-specific
  output schemas for the AI CRM. Use when creating or modifying agents
  (crm-agent, call-summarizer, live-assist, pipeline-analyzer) or their
  associated tools.
---

# Mastra Agents

## Agent Contract

Every agent MUST:
- Have `maxSteps` between 1 and 10 (firewall Rule 12)
- Have a validated output Zod schema
- Be called through `validateAndFilterOutput()` after generation (firewall Rule 10)
- Reference tools that all have `inputSchema`, `id` slug, `description` >= 20 chars (Rule 11)

## Agent Definitions

### CRM Agent (agents/crm-agent.ts)
**Purpose:** Handles WhatsApp/SMS customer messages with context-aware replies.
**Tools:** `lookupContact`, `getDeals`, `getTickets`, `updateDeal`, `createTicket`
**maxSteps:** 8
**System prompt:** CRM persona, tool descriptions, contact context injection.

### Call Summarizer (agents/call-summarizer.ts)
**Purpose:** Post-call transcript → structured summary.
**Trigger:** Call hangup event.
**Output schema:**
```ts
const CallSummary = z.object({
  summary: z.string().max(500),
  actionItems: z.array(z.string().max(200)).max(10),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  suggestedCRMUpdates: z.array(z.object({
    entity: z.enum(["deal", "contact", "ticket"]),
    field: z.string(),
    value: z.string(),
  })).max(5),
});
```
**maxSteps:** 5

### Live Assist (agents/live-assist.ts)
**Purpose:** During a live voice call, surfaces real-time prompts to the human rep.
**Trigger:** Every 30s during active call or on notable transcript segments.
**Output schema:**
```ts
const LiveAssistOutput = z.object({
  prompt: z.string().max(300),
  confidence: z.number().min(0).max(1),
  sourceEntity: z.enum(["deal", "ticket", "contact", "account"]).optional(),
});
```
**maxSteps:** 4

### Pipeline Analyzer (agents/pipeline-analyzer.ts)
**Purpose:** Scheduled/on-demand pipeline health report.
**Tools:** Uses `IGraphRetriever.getStaleDeals()` indirectly via orchestrator.
**Output schema:**
```ts
const PipelineReport = z.object({
  atRiskDeals: z.array(z.object({
    dealId: z.string(),
    name: z.string(),
    risk: z.enum(["stalled", "no_contact", "budget_risk"]),
    daysSinceLastUpdate: z.number(),
  })).max(20),
  accountHealthSummary: z.array(z.object({
    accountId: z.string(),
    name: z.string(),
    healthScore: z.number().min(0).max(100),
  })).max(10),
});
```
**maxSteps:** 6

## Tool Contract (firewall Rule 11)

Every `createTool({...})` call:
```ts
createTool({
  id: "tool-name-slug",             // /^[a-z0-9-]+$/
  description: "Description >= 20 chars explaining what tool does...",
  inputSchema: z.object({ ... }),   // MUST be present
  execute: async ({ context }) => { ... },
});
```
