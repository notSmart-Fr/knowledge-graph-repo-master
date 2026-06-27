import type { IGraphRetriever, CRMGraphContext, Contact, Deal, Ticket, Call, Account } from "../../core/ports.js";
import {
  CRMGraphContextSchema,
  ContactSchema,
  DealSchema,
  TicketSchema,
  CallSchema,
} from "../../core/ports.js";
import { neo4jDriver } from "./client.js";
import { GraphTraversalError } from "../../core/errors.js";

export class Neo4jGraphRetriever implements IGraphRetriever {
  async expandFromContact(contactId: string): Promise<CRMGraphContext> {
    const session = neo4jDriver.session();

    try {
      const result = await session.run(
        `
        MATCH (c:Contact {id: $contactId})
        OPTIONAL MATCH (c)-[:WORKS_AT]->(a:Account)
        OPTIONAL MATCH (c)-[:DECISION_MAKER_FOR]->(d:Deal)
        OPTIONAL MATCH (c)-[:REPORTED_TO]->(t:Ticket)
        OPTIONAL MATCH (c)-[:WITH]->(call:Call)
        RETURN c, a, collect(DISTINCT d) AS deals, collect(DISTINCT t) AS tickets, collect(DISTINCT call) AS calls
        `,
        { contactId }
      );

      const record = result.records[0];
      if (!record) {
        return CRMGraphContextSchema.parse({ deals: [], tickets: [], calls: [] });
      }

      const contact = this.nodeToContact(record.get("c"));
      const account = record.get("a") ? this.nodeToAccount(record.get("a")) : undefined;
      const deals = record.get("deals").map(this.nodeToDeal);
      const tickets = record.get("tickets").map(this.nodeToTicket);
      const calls = record.get("calls").map(this.nodeToCall);

      return CRMGraphContextSchema.parse({
        contact,
        account,
        deals,
        tickets,
        calls,
      });
    } catch (err: unknown) {
      throw new GraphTraversalError(
        "Failed to expand from contact",
        { originalError: String(err) }
      );
    } finally {
      await session.close();
    }
  }

  async expandFromDeal(dealId: string): Promise<CRMGraphContext> {
    const session = neo4jDriver.session();

    try {
      const result = await session.run(
        `
        MATCH (d:Deal {id: $dealId})
        OPTIONAL MATCH (d)<-[:DECISION_MAKER_FOR]-(c:Contact)
        OPTIONAL MATCH (c)-[:WORKS_AT]->(a:Account)
        OPTIONAL MATCH (c)-[:REPORTED_TO]->(t:Ticket)
        OPTIONAL MATCH (c)-[:WITH]->(call:Call)
        RETURN d, c, a, collect(DISTINCT t) AS tickets, collect(DISTINCT call) AS calls
        `,
        { dealId }
      );

      const record = result.records[0];
      if (!record) {
        return CRMGraphContextSchema.parse({ deals: [], tickets: [], calls: [] });
      }

      const contact = record.get("c") ? this.nodeToContact(record.get("c")) : undefined;
      const account = record.get("a") ? this.nodeToAccount(record.get("a")) : undefined;
      const deal = this.nodeToDeal(record.get("d"));
      const tickets = record.get("tickets").map(this.nodeToTicket);
      const calls = record.get("calls").map(this.nodeToCall);

      return CRMGraphContextSchema.parse({
        contact,
        account,
        deals: [deal],
        tickets,
        calls,
      });
    } catch (err: unknown) {
      throw new GraphTraversalError(
        "Failed to expand from deal",
        { originalError: String(err) }
      );
    } finally {
      await session.close();
    }
  }

  async getStaleDeals(days: number): Promise<Deal[]> {
    const session = neo4jDriver.session();

    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const result = await session.run(
        `
        MATCH (d:Deal)
        WHERE d.updated_at < $cutoff OR d.updated_at IS NULL
        RETURN d
        `,
        { cutoff: cutoff.toISOString() }
      );

      return result.records.map((record: { get: (arg0: string) => unknown; }) => this.nodeToDeal(record.get("d")));
    } catch (err: unknown) {
      throw new GraphTraversalError(
        "Failed to get stale deals",
        { originalError: String(err) }
      );
    } finally {
      await session.close();
    }
  }

  private nodeToContact(node: unknown): Contact {
    const n = node as { properties: Record<string, unknown> };
    return ContactSchema.parse({
      id: n.properties.id,
      name: n.properties.name,
      phone: n.properties.phone,
      email: n.properties.email,
      accountId: n.properties.accountId,
      role: n.properties.role,
      tags: n.properties.tags || [],
      agentId: n.properties.agentId,
      createdAt: n.properties.createdAt,
    });
  }

  private nodeToAccount(node: unknown): Account {
    const n = node as { properties: Record<string, unknown> };
    return {
      id: n.properties.id,
      name: n.properties.name,
      industry: n.properties.industry,
      size: n.properties.size,
      healthScore: n.properties.healthScore,
      createdAt: n.properties.createdAt,
    };
  }

  private nodeToDeal(node: unknown): Deal {
    const n = node as { properties: Record<string, unknown> };
    return DealSchema.parse({
      id: n.properties.id,
      name: n.properties.name,
      amount: n.properties.amount,
      stage: n.properties.stage,
      contactId: n.properties.contactId,
      accountId: n.properties.accountId,
      probability: n.properties.probability,
      expectedClose: n.properties.expectedClose,
      agentId: n.properties.agentId,
      createdAt: n.properties.createdAt,
    });
  }

  private nodeToTicket(node: unknown): Ticket {
    const n = node as { properties: Record<string, unknown> };
    return TicketSchema.parse({
      id: n.properties.id,
      contactId: n.properties.contactId,
      subject: n.properties.subject,
      status: n.properties.status,
      priority: n.properties.priority,
      agentId: n.properties.agentId,
      createdAt: n.properties.createdAt,
    });
  }

  private nodeToCall(node: unknown): Call {
    const n = node as { properties: Record<string, unknown> };
    return CallSchema.parse({
      id: n.properties.id,
      contactId: n.properties.contactId,
      agentId: n.properties.agentId,
      direction: n.properties.direction,
      transcriptJson: n.properties.transcriptJson || {},
      summary: n.properties.summary,
      sentiment: n.properties.sentiment,
      actionItems: n.properties.actionItems || [],
      durationSec: n.properties.durationSec,
      createdAt: n.properties.createdAt,
    });
  }
}
