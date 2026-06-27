import type { IIdempotencyStore } from "../../core/ports.js";
import { supabaseServiceClient } from "../supabase/client.js";
import { DatabaseDomainError } from "../../core/errors.js";

export class SupabaseIdempotencyStore implements IIdempotencyStore {
  async checkAndSet(key: string, ttl: number): Promise<boolean> {
    try {
      const { error: insertError } = await supabaseServiceClient
        .from("idempotency_keys")
        .insert({ key, expires_at: new Date(Date.now() + ttl * 1000).toISOString() });

      if (insertError) {
        if (insertError.code === "23505") {
          return false;
        }
        throw new DatabaseDomainError(
          "SUPABASE_IDEMPOTENCY_FAILED",
          insertError.message,
          { code: insertError.code }
        );
      }

      return true;
    } catch (err: unknown) {
      if (err instanceof DatabaseDomainError) throw err;
      throw new DatabaseDomainError(
        "SUPABASE_IDEMPOTENCY_FAILED",
        "Failed to check and set idempotency key",
        { originalError: String(err) }
      );
    }
  }
}
