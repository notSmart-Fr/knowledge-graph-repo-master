import type { ITicketStore, Ticket } from "../../core/ports.js";
import { TicketSchema } from "../../core/ports.js";
import { supabaseServiceClient } from "./client.js";
import { DatabaseDomainError } from "../../core/errors.js";
import { auditLogWriter } from "./audit-log.js";

export class SupabaseTicketStore implements ITicketStore {
  async getByContact(contactId: string): Promise<Ticket[]> {
    const { data, error } = await supabaseServiceClient
      .from("support_tickets")
      .select("*")
      .eq("contact_id", contactId);

    if (error) {
      throw new DatabaseDomainError("TICKET_LOOKUP_FAILED", error.message, { code: error.code });
    }

    const tickets = data.map((item) => TicketSchema.parse(this.snakeToCamel(item)));
    for (const ticket of tickets) {
      await auditLogWriter.log({
        action: "READ",
        entityType: "ticket",
        entityId: ticket.id,
      });
    }
    return tickets;
  }

  async create(ticket: Omit<Ticket, "id" | "createdAt">): Promise<Ticket> {
    const { data, error } = await supabaseServiceClient
      .from("support_tickets")
      .insert(this.camelToSnake(ticket))
      .select("*")
      .single();

    if (error) {
      throw new DatabaseDomainError("TICKET_CREATE_FAILED", error.message, { code: error.code });
    }

    const createdTicket = TicketSchema.parse(this.snakeToCamel(data));
    await auditLogWriter.log({
      action: "CREATE",
      entityType: "ticket",
      entityId: createdTicket.id,
    });
    return createdTicket;
  }

  private snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      result[camelKey] = value;
    }
    return result;
  }

  private camelToSnake(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const snakeKey = key.replace(/([A-Z])/g, (_, letter) => `_${letter.toLowerCase()}`);
      result[snakeKey] = value;
    }
    return result;
  }
}
