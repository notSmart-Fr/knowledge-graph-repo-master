import { TicketSchema } from "../../core/ports.js";
import { supabaseServiceClient } from "./client.js";
import { DatabaseDomainError } from "../../core/errors.js";
export class SupabaseTicketStore {
    async getByContact(contactId) {
        const { data, error } = await supabaseServiceClient
            .from("support_tickets")
            .select("*")
            .eq("contact_id", contactId);
        if (error) {
            throw new DatabaseDomainError("TICKET_LOOKUP_FAILED", error.message, { code: error.code });
        }
        return data.map((item) => TicketSchema.parse(this.snakeToCamel(item)));
    }
    async create(ticket) {
        const { data, error } = await supabaseServiceClient
            .from("support_tickets")
            .insert(this.camelToSnake(ticket))
            .select("*")
            .single();
        if (error) {
            throw new DatabaseDomainError("TICKET_CREATE_FAILED", error.message, { code: error.code });
        }
        return TicketSchema.parse(this.snakeToCamel(data));
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
