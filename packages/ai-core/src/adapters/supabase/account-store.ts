import type { IAccountStore, Account } from "../../core/ports.js";
import { AccountSchema } from "../../core/ports.js";
import { supabaseServiceClient } from "./client.js";
import { DatabaseDomainError } from "../../core/errors.js";

export class SupabaseAccountStore implements IAccountStore {
  async getById(id: string): Promise<Account | null> {
    const { data, error } = await supabaseServiceClient
      .from("accounts")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return null;
      }
      throw new DatabaseDomainError("ACCOUNT_LOOKUP_FAILED", error.message, { code: error.code });
    }

    return AccountSchema.parse(this.snakeToCamel(data));
  }

  async getHealthScore(id: string): Promise<number | null> {
    const { data, error } = await supabaseServiceClient
      .from("accounts")
      .select("health_score")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return null;
      }
      throw new DatabaseDomainError("ACCOUNT_HEALTH_LOOKUP_FAILED", error.message, { code: error.code });
    }

    return data.health_score ?? null;
  }

  private snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      result[camelKey] = value;
    }
    return result;
  }
}
