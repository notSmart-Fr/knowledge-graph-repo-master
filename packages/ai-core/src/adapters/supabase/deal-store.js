import { DealSchema } from "../../core/ports.js";
import { supabaseServiceClient } from "./client.js";
import { DatabaseDomainError } from "../../core/errors.js";
export class SupabaseDealStore {
    async getByContact(contactId) {
        const { data, error } = await supabaseServiceClient
            .from("deals")
            .select("*")
            .eq("contact_id", contactId);
        if (error) {
            throw new DatabaseDomainError("DEAL_LOOKUP_FAILED", error.message, { code: error.code });
        }
        return data.map((item) => DealSchema.parse(this.snakeToCamel(item)));
    }
    async getById(id) {
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
        return DealSchema.parse(this.snakeToCamel(data));
    }
    async update(dealId, fields) {
        const { data, error } = await supabaseServiceClient
            .from("deals")
            .update(this.camelToSnake(fields))
            .eq("id", dealId)
            .select("*")
            .single();
        if (error) {
            throw new DatabaseDomainError("DEAL_UPDATE_FAILED", error.message, { code: error.code });
        }
        return DealSchema.parse(this.snakeToCamel(data));
    }
    snakeToCamel(obj) {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
            result[camelKey] = value;
        }
        return result;
    }
    camelToSnake(obj) {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            const snakeKey = key.replace(/([A-Z])/g, (_, letter) => `_${letter.toLowerCase()}`);
            result[snakeKey] = value;
        }
        return result;
    }
}
