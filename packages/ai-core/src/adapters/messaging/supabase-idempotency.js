import { supabaseServiceClient } from "../supabase/client.js";
import { DatabaseDomainError } from "../../core/errors.js";
export class SupabaseIdempotencyStore {
    async checkAndSet(key, ttl) {
        try {
            const { error: insertError } = await supabaseServiceClient
                .from("idempotency_keys")
                .insert({ key, expires_at: new Date(Date.now() + ttl * 1000).toISOString() });
            if (insertError) {
                if (insertError.code === "23505") {
                    return false;
                }
                throw new DatabaseDomainError("SUPABASE_IDEMPOTENCY_FAILED", insertError.message, { code: insertError.code });
            }
            return true;
        }
        catch (err) {
            if (err instanceof DatabaseDomainError)
                throw err;
            throw new DatabaseDomainError("SUPABASE_IDEMPOTENCY_FAILED", "Failed to check and set idempotency key", { originalError: String(err) });
        }
    }
}
