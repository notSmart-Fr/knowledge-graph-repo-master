/**
 * Sync Supabase CRM rows into Neo4j for graph RAG.
 *
 * Usage: npx tsx scripts/ingest.ts
 *        npx tsx scripts/ingest.ts --dry-run
 */

import { loadMonorepoEnv } from "./load-env.js";
loadMonorepoEnv();

import { createLogger } from "../packages/ai-core/src/core/logger.js";
import { supabaseServiceClient } from "../packages/ai-core/src/adapters/supabase/client.js";
import { neo4jDriver } from "../packages/ai-core/src/adapters/neo4j/client.js";
import { fieldEncryption } from "../packages/ai-core/src/adapters/encryption/field-encryption.js";

const logger = createLogger("ingest");

function snakeToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = value;
  }
  return out;
}

function toIso(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return new Date().toISOString();
}

export async function runIngest(dryRun = false): Promise<void> {
  logger.info("Starting Neo4j ingest", { dryRun });

  const [accountsRes, contactsRes, dealsRes, ticketsRes, callsRes] = await Promise.all([
    supabaseServiceClient.from("accounts").select("*"),
    supabaseServiceClient.from("contacts").select("*"),
    supabaseServiceClient.from("deals").select("*"),
    supabaseServiceClient.from("support_tickets").select("*"),
    supabaseServiceClient.from("calls").select("*"),
  ]);

  for (const res of [accountsRes, contactsRes, dealsRes, ticketsRes, callsRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const accounts = accountsRes.data ?? [];
  const contacts = contactsRes.data ?? [];
  const deals = dealsRes.data ?? [];
  const tickets = ticketsRes.data ?? [];
  const calls = callsRes.data ?? [];

  if (dryRun) {
    logger.info("Dry run counts", {
      accounts: accounts.length,
      contacts: contacts.length,
      deals: deals.length,
      tickets: tickets.length,
      calls: calls.length,
    });
    return;
  }

  const session = neo4jDriver.session();
  try {
    await session.run("MATCH (n) DETACH DELETE n");

    for (const row of accounts) {
      await session.run(
        `CREATE (a:Account {
          id: $id, name: $name, industry: $industry, size: $size,
          healthScore: $healthScore, createdAt: $createdAt
        })`,
        {
          id: row.id,
          name: row.name,
          industry: row.industry,
          size: row.size,
          healthScore: row.health_score,
          createdAt: toIso(row.created_at),
        }
      );
    }

    for (const row of contacts) {
      const camel = snakeToCamel(row as Record<string, unknown>);
      const decrypted = fieldEncryption.decryptObject(
        camel,
        row.id as string,
        ["phone", "email"],
        "contact"
      );
      await session.run(
        `CREATE (c:Contact {
          id: $id, name: $name, phone: $phone, email: $email,
          accountId: $accountId, role: $role, tags: $tags, createdAt: $createdAt
        })`,
        {
          id: row.id,
          name: row.name,
          phone: decrypted.phone,
          email: decrypted.email,
          accountId: row.account_id ?? null,
          role: row.role,
          tags: row.tags ?? [],
          createdAt: toIso(row.created_at),
        }
      );
      if (row.account_id) {
        await session.run(
          `MATCH (c:Contact {id: $contactId}), (a:Account {id: $accountId})
           CREATE (c)-[:WORKS_AT]->(a)`,
          { contactId: row.id, accountId: row.account_id }
        );
      }
    }

    for (const row of deals) {
      await session.run(
        `CREATE (d:Deal {
          id: $id, name: $name, amount: $amount, stage: $stage,
          contactId: $contactId, accountId: $accountId, probability: $probability,
          expectedClose: $expectedClose, createdAt: $createdAt
        })`,
        {
          id: row.id,
          name: row.name,
          amount: row.amount,
          stage: row.stage,
          contactId: row.contact_id,
          accountId: row.account_id,
          probability: row.probability,
          expectedClose: row.expected_close ? toIso(row.expected_close) : null,
          createdAt: toIso(row.created_at),
        }
      );
      await session.run(
        `MATCH (c:Contact {id: $contactId}), (d:Deal {id: $dealId})
         CREATE (c)-[:DECISION_MAKER_FOR]->(d)`,
        { contactId: row.contact_id, dealId: row.id }
      );
    }

    for (const row of tickets) {
      await session.run(
        `CREATE (t:Ticket {
          id: $id, contactId: $contactId, subject: $subject, status: $status,
          priority: $priority, createdAt: $createdAt
        })`,
        {
          id: row.id,
          contactId: row.contact_id,
          subject: row.subject,
          status: row.status,
          priority: row.priority,
          createdAt: toIso(row.created_at),
        }
      );
      await session.run(
        `MATCH (c:Contact {id: $contactId}), (t:Ticket {id: $ticketId})
         CREATE (c)-[:REPORTED_TO]->(t)`,
        { contactId: row.contact_id, ticketId: row.id }
      );
    }

    for (const row of calls) {
      await session.run(
        `CREATE (call:Call {
          id: $id, contactId: $contactId, direction: $direction,
          transcriptJson: $transcriptJson, summary: $summary, sentiment: $sentiment,
          actionItems: $actionItems, durationSec: $durationSec, createdAt: $createdAt
        })`,
        {
          id: row.id,
          contactId: row.contact_id,
          direction: row.direction,
          transcriptJson: row.transcript_json ?? {},
          summary: row.summary,
          sentiment: row.sentiment,
          actionItems: row.action_items ?? [],
          durationSec: row.duration_sec,
          createdAt: toIso(row.created_at),
        }
      );
      await session.run(
        `MATCH (c:Contact {id: $contactId}), (call:Call {id: $callId})
         CREATE (c)-[:WITH]->(call)`,
        { contactId: row.contact_id, callId: row.id }
      );
    }

    const countResult = await session.run(
      "MATCH (n) RETURN labels(n)[0] AS label, count(*) AS count ORDER BY label"
    );
    const summary: Record<string, number> = {};
    for (const record of countResult.records) {
      summary[String(record.get("label"))] = Number(record.get("count"));
    }
    logger.info("Ingest complete", { nodes: summary });
    console.log("\n✓ Neo4j ingest complete:", summary);
  } finally {
    await session.close();
    await neo4jDriver.close();
  }
}

const dryRun = process.argv.includes("--dry-run");
runIngest(dryRun).catch((error: unknown) => {
  logger.error("Ingest failed", { error: String(error) });
  console.error("\n✗ Ingest failed:", error);
  process.exit(1);
});
