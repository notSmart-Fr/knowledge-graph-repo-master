import { CallSchema } from "../../core/ports.js";
import { supabaseServiceClient } from "./client.js";
import { DatabaseDomainError } from "../../core/errors.js";
export class SupabaseCallStore {
    async create(call) {
        const { data, error } = await supabaseServiceClient
            .from("calls")
            .insert(this.camelToSnake(call))
            .select("*")
            .single();
        if (error) {
            throw new DatabaseDomainError("CALL_CREATE_FAILED", error.message, { code: error.code });
        }
        return CallSchema.parse(this.snakeToCamel(data));
    }
    async appendTranscript(callId, chunk) {
        const { data: currentCall } = await supabaseServiceClient
            .from("calls")
            .select("transcript_json")
            .eq("id", callId)
            .single();
        const updatedTranscript = {
            ...(currentCall?.transcript_json || {}),
            ...chunk,
        };
        const { error } = await supabaseServiceClient
            .from("calls")
            .update({ transcript_json: updatedTranscript })
            .eq("id", callId);
        if (error) {
            throw new DatabaseDomainError("TRANSCRIPT_APPEND_FAILED", error.message, { code: error.code });
        }
    }
    async finalize(callId, summary) {
        const { data, error } = await supabaseServiceClient
            .from("calls")
            .update({ summary })
            .eq("id", callId)
            .select("*")
            .single();
        if (error) {
            throw new DatabaseDomainError("CALL_FINALIZE_FAILED", error.message, { code: error.code });
        }
        return CallSchema.parse(this.snakeToCamel(data));
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
