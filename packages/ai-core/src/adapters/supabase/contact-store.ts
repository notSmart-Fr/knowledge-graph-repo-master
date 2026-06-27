import type { IContactStore, Contact } from "../../core/ports.js";
import { ContactSchema } from "../../core/ports.js";
import { supabaseServiceClient } from "./client.js";
import { DatabaseDomainError } from "../../core/errors.js";

export class SupabaseContactStore implements IContactStore {
  async getByPhone(phone: string): Promise<Contact | null> {
    const { data, error } = await supabaseServiceClient
      .from("contacts")
      .select("*")
      .eq("phone", phone)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return null;
      }
      throw new DatabaseDomainError("CONTACT_LOOKUP_FAILED", error.message, { code: error.code });
    }

    return ContactSchema.parse(this.snakeToCamel(data));
  }

  async getById(id: string): Promise<Contact | null> {
    const { data, error } = await supabaseServiceClient
      .from("contacts")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return null;
      }
      throw new DatabaseDomainError("CONTACT_LOOKUP_FAILED", error.message, { code: error.code });
    }

    return ContactSchema.parse(this.snakeToCamel(data));
  }

  async search(query: string): Promise<Contact[]> {
    const { data, error } = await supabaseServiceClient
      .from("contacts")
      .select("*")
      .or(`name.ilike.%${query}%,email.ilike.%${query}%`);

    if (error) {
      throw new DatabaseDomainError("CONTACT_SEARCH_FAILED", error.message, { code: error.code });
    }

    return data.map((item) => ContactSchema.parse(this.snakeToCamel(item)));
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
