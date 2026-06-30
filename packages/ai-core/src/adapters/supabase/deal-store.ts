import type { IDealStore, Deal } from "../../core/ports.js";
import { DealSchema } from "../../core/ports.js";
import { supabaseServiceClient } from "./client.js";
import { DatabaseDomainError } from "../../core/errors.js";
import { auditLogWriter } from "./audit-log.js";

export class SupabaseDealStore implements IDealStore {
  async getByContact(contactId: string): Promise<Deal[]> {
    const { data, error } = await supabaseServiceClient
      .from("deals")
      .select("*")
      .eq("contact_id", contactId);

    if (error) {
      throw new DatabaseDomainError("DEAL_LOOKUP_FAILED", error.message, { code: error.code });
    }

    const deals = data.map((item) => DealSchema.parse(this.snakeToCamel(item)));
    for (const deal of deals) {
      await auditLogWriter.log({
        action: "READ",
        entityType: "deal",
        entityId: deal.id,
      });
    }
    return deals;
  }

  async getById(id: string): Promise<Deal | null> {
    const { data, error } = await supabaseServiceClient
      .from("deals")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return null;
      }
      throw new DatabaseDomainError("DEAL_LOOKUP_FAILED", error.message, { code: error.code });
    }

    await auditLogWriter.log({
      action: "READ",
      entityType: "deal",
      entityId: id,
    });
    return DealSchema.parse(this.snakeToCamel(data));
  }

  async update(dealId: string, fields: Partial<Deal>): Promise<Deal> {
    const { data, error } = await supabaseServiceClient
      .from("deals")
      .update(this.camelToSnake(fields))
      .eq("id", dealId)
      .select("*")
      .single();

    if (error) {
      throw new DatabaseDomainError("DEAL_UPDATE_FAILED", error.message, { code: error.code });
    }

    await auditLogWriter.log({
      action: "UPDATE",
      entityType: "deal",
      entityId: dealId,
    });
    return DealSchema.parse(this.snakeToCamel(data));
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
