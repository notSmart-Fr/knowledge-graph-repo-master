import type { IContactStore, Contact } from "../../core/ports.js";
import { ContactSchema } from "../../core/ports.js";
import { supabaseServiceClient } from "./client.js";
import { DatabaseDomainError } from "../../core/errors.js";
import { fieldEncryption } from "../encryption/field-encryption.js";
import { auditLogWriter } from "./audit-log.js";
import crypto from "node:crypto";

export class SupabaseContactStore implements IContactStore {
  async getByPhone(phone: string): Promise<Contact | null> {
    // To lookup by phone, we need to scan and decrypt (since phone is encrypted)
    const { data, error } = await supabaseServiceClient
      .from("contacts")
      .select("*");

    if (error) {
      throw new DatabaseDomainError("CONTACT_LOOKUP_FAILED", error.message, { code: error.code });
    }

    for (const item of data) {
      const camelData = this.snakeToCamel(item);
      const decryptedData = fieldEncryption.decryptObject(
        camelData as Record<string, unknown>,
        item.id,
        ["phone", "email"],
        "contact"
      );
      const contact = ContactSchema.parse(decryptedData);
      if (contact.phone === phone) {
        await auditLogWriter.log({
          action: "READ",
          entityType: "contact",
          entityId: contact.id,
        });
        return contact;
      }
    }

    return null;
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

    await auditLogWriter.log({
      action: "READ",
      entityType: "contact",
      entityId: id,
    });
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

    const contacts = data.map((item) => {
      const camelData = this.snakeToCamel(item);
      const decryptedData = fieldEncryption.decryptObject(
        camelData as Record<string, unknown>,
        item.id,
        ["phone", "email"],
        "contact"
      );
      return ContactSchema.parse(decryptedData);
    });

    for (const contact of contacts) {
      await auditLogWriter.log({
        action: "READ",
        entityType: "contact",
        entityId: contact.id,
      });
    }
    return contacts;
  }

  async create(contact: Omit<Contact, "id" | "createdAt">): Promise<Contact> {
    const id = crypto.randomUUID();
    const contactWithId = { ...contact, id };
    const encryptedData = fieldEncryption.encryptObject(
      contactWithId as Record<string, unknown>,
      id,
      ["phone", "email"],
      "contact"
    );

    const { data, error } = await supabaseServiceClient
      .from("contacts")
      .insert(this.camelToSnake(encryptedData as Record<string, unknown>))
      .select("*")
      .single();

    if (error) {
      throw new DatabaseDomainError("CONTACT_CREATE_FAILED", error.message, { code: error.code });
    }

    const camelData = this.snakeToCamel(data);
    const decryptedData = fieldEncryption.decryptObject(
      camelData as Record<string, unknown>,
      data.id,
      ["phone", "email"],
      "contact"
    );

    await auditLogWriter.log({
      action: "CREATE",
      entityType: "contact",
      entityId: id,
    });
    return ContactSchema.parse(decryptedData);
  }

  async update(id: string, fields: Partial<Contact>): Promise<Contact> {
    const { data: existingData, error: existingError } = await supabaseServiceClient
      .from("contacts")
      .select("*")
      .eq("id", id)
      .single();

    if (existingError) {
      throw new DatabaseDomainError("CONTACT_LOOKUP_FAILED", existingError.message, { code: existingError.code });
    }

    const updatedFields = { ...fields };
    if (updatedFields.phone || updatedFields.email) {
      const encryptedData = fieldEncryption.encryptObject(
        { id, ...updatedFields },
        id,
        ["phone", "email"],
        "contact"
      );
      Object.assign(updatedFields, encryptedData);
    }

    const { data, error } = await supabaseServiceClient
      .from("contacts")
      .update(this.camelToSnake(updatedFields as Record<string, unknown>))
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      throw new DatabaseDomainError("CONTACT_UPDATE_FAILED", error.message, { code: error.code });
    }

    const camelData = this.snakeToCamel(data);
    const decryptedData = fieldEncryption.decryptObject(
      camelData as Record<string, unknown>,
      data.id,
      ["phone", "email"],
      "contact"
    );

    await auditLogWriter.log({
      action: "UPDATE",
      entityType: "contact",
      entityId: id,
    });
    return ContactSchema.parse(decryptedData);
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
