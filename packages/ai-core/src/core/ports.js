import { z } from "zod";
// Domain Types
export const ContactSchema = z.object({
    id: z.string(),
    name: z.string(),
    phone: z.string(),
    email: z.string().email(),
    accountId: z.string().optional(),
    role: z.enum(["lead", "contact", "decision_maker"]),
    tags: z.array(z.string()),
    agentId: z.string().optional(),
    createdAt: z.string().datetime(),
});
export const DealSchema = z.object({
    id: z.string(),
    name: z.string(),
    amount: z.number(),
    stage: z.string(),
    contactId: z.string(),
    accountId: z.string().optional(),
    probability: z.number().min(0).max(100),
    expectedClose: z.string().datetime().optional(),
    agentId: z.string().optional(),
    createdAt: z.string().datetime(),
});
export const CallSchema = z.object({
    id: z.string(),
    contactId: z.string(),
    agentId: z.string().optional(),
    direction: z.enum(["inbound", "outbound"]),
    transcriptJson: z.record(z.unknown()),
    summary: z.string().optional(),
    sentiment: z.enum(["positive", "neutral", "negative"]),
    actionItems: z.array(z.string()),
    durationSec: z.number().optional(),
    createdAt: z.string().datetime(),
});
export const TicketSchema = z.object({
    id: z.string(),
    contactId: z.string(),
    subject: z.string(),
    status: z.enum(["open", "in_progress", "closed", "on_hold"]),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    agentId: z.string().optional(),
    createdAt: z.string().datetime(),
});
export const AccountSchema = z.object({
    id: z.string(),
    name: z.string(),
    industry: z.string().optional(),
    size: z.enum(["small", "medium", "enterprise"]).optional(),
    healthScore: z.number().min(0).max(100).optional(),
    createdAt: z.string().datetime(),
});
export const PipelineStageSchema = z.object({
    id: z.string(),
    name: z.string(),
    sortOrder: z.number(),
    probability: z.number().min(0).max(100),
});
export const CRMGraphContextSchema = z.object({
    contact: ContactSchema.optional(),
    account: AccountSchema.optional(),
    deals: z.array(DealSchema).default([]),
    tickets: z.array(TicketSchema).default([]),
    calls: z.array(CallSchema).default([]),
});
export const CachedResponseSchema = z.object({
    id: z.string(),
    response: z.record(z.unknown()),
    intentTags: z.array(z.string()).default([]),
    model: z.string(),
    createdAt: z.string().datetime(),
});
export const OrchestratorResponseSchema = z.object({
    text: z.string(),
    metadata: z.object({
        degraded: z.boolean().default(false),
        cacheHit: z.boolean().default(false),
        modelUsed: z.string().optional(),
    }),
});
