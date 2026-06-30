import { getEnv } from "../../config/env-schema.js";
import { supabaseServiceClient } from "../../adapters/supabase/client.js";
import { fieldEncryption } from "../../adapters/encryption/field-encryption.js";
import { DatabaseDomainError } from "../../core/errors.js";

export interface DsarExport {
  contact: Record<string, unknown>;
  deals: Record<string, unknown>[];
  calls: Record<string, unknown>[];
  tickets: Record<string, unknown>[];
  auditLogs: Record<string, unknown>[];
}

export class DsarService {
  async export(contactId: string): Promise<DsarExport | null> {
    const env = getEnv();
    if (!env.DSAR_ENABLED) {
      return null;
    }

    // Get contact
    const { data: contactData, error: contactError } = await supabaseServiceClient
      .from("contacts")
      .select("*")
      .eq("id", contactId)
      .single();

    if (contactError) {
      if (contactError.code === "PGRST116") {
        return null;
      }
      throw new DatabaseDomainError("DSAR_CONTACT_LOOKUP_FAILED", contactError.message, { code: contactError.code });
    }

    const contact = fieldEncryption.decryptObject(
      contactData as Record<string, unknown>,
      contactData.id,
      ["phone", "email"],
      "contact"
    );

    // Get deals
    const { data: dealsData, error: dealsError } = await supabaseServiceClient
      .from("deals")
      .select("*")
      .eq("contact_id", contactId);

    if (dealsError) {
      throw new DatabaseDomainError("DSAR_DEALS_LOOKUP_FAILED", dealsError.message, { code: dealsError.code });
    }

    // Get calls
    const { data: callsData, error: callsError } = await supabaseServiceClient
      .from("calls")
      .select("*")
      .eq("contact_id", contactId);

    if (callsError) {
      throw new DatabaseDomainError("DSAR_CALLS_LOOKUP_FAILED", callsError.message, { code: callsError.code });
    }

    const calls = callsData.map((call) =>
      fieldEncryption.decryptObject(
        call as Record<string, unknown>,
        call.id,
        ["transcript_json"],
        "call"
      )
    );

    // Get tickets
    const { data: ticketsData, error: ticketsError } = await supabaseServiceClient
      .from("support_tickets")
      .select("*")
      .eq("contact_id", contactId);

    if (ticketsError) {
      throw new DatabaseDomainError("DSAR_TICKETS_LOOKUP_FAILED", ticketsError.message, { code: ticketsError.code });
    }

    // Get audit logs
    const { data: auditLogsData, error: auditLogsError } = await supabaseServiceClient
      .from("audit_logs")
      .select("*")
      .eq("entity_id", contactId)
      .or(`entity_type.eq.contact,entity_type.eq.deal,entity_type.eq.call,entity_type.eq.ticket`);

    if (auditLogsError) {
      throw new DatabaseDomainError("DSAR_AUDIT_LOOKUP_FAILED", auditLogsError.message, { code: auditLogsError.code });
    }

    return {
      contact,
      deals: dealsData,
      calls,
      tickets: ticketsData,
      auditLogs: auditLogsData,
    };
  }

  async deleteByOwner(ownerId: string): Promise<void> {
    const env = getEnv();
    if (!env.DSAR_ENABLED) {
      return;
    }

    // Delete tickets
    await supabaseServiceClient
      .from("support_tickets")
      .delete()
      .eq("contact_id", ownerId);

    // Delete calls
    await supabaseServiceClient
      .from("calls")
      .delete()
      .eq("contact_id", ownerId);

    // Delete deals
    await supabaseServiceClient
      .from("deals")
      .delete()
      .eq("contact_id", ownerId);

    // Delete contact
    await supabaseServiceClient
      .from("contacts")
      .delete()
      .eq("id", ownerId);

    // Delete audit logs
    await supabaseServiceClient
      .from("audit_logs")
      .delete()
      .eq("entity_id", ownerId)
      .or(`entity_type.eq.contact,entity_type.eq.deal,entity_type.eq.call,entity_type.eq.ticket`);
  }
}

export const dsarService = new DsarService();
