import type { IContactStore, Contact } from "../../core/ports.js";
import { ContactSchema } from "../../core/ports.js";
import { supabaseServiceClient } from "./client.js";
import { DatabaseDomainError } from "../../core/errors.js";
import { fieldEncryption } from "../encryption/field-encryption.js";

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

    const camelData = this.snakeToCamel(data);
    const decryptedData = fieldEncryption.decryptObject(
      camelData as Record<string, unknown>,
      data.id,
      ["phone", "email"],
      "contact"
    );

    return ContactSchema.parse(decryptedData);
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

    const camelData = this.snakeToCamel(data);
    const decryptedData = fieldEncryption.decryptObject(
      camelData as Record<string, unknown>,
      data.id,
      ["phone", "email"],
      "contact"
    );

    return ContactSchema.parse(decryptedData);
  }

  async search(query: string): Promise<Contact[]> {
    const { data, error } = await supabaseServiceClient
      .from("contacts")
      .select("*")
      .or(`name.ilike.%${query}%`);

    if (error) {
      throw new DatabaseDomainError("CONTACT_SEARCH_FAILED", error.message, { code: error.code });
    }

    return data.map((item) => {
      const camelData = this.snakeToCamel(item);
      const decryptedData = fieldEncryption.decryptObject(
        camelData as Record<string, unknown>,
        item.id,
        ["phone", "email"],
        "contact"
      );
      return ContactSchema.parse(decryptedData);
    });
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
