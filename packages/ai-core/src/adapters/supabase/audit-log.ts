import { supabaseServiceClient } from "./client.js";
import { DatabaseDomainError } from "../../core/errors.js";

export interface AuditLogEntry {
  actorId?: string;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

export class AuditLogWriter {
  async log(entry: AuditLogEntry): Promise<void> {
    const { error } = await supabaseServiceClient
      .from("audit_logs")
      .insert({
        actor_id: entry.actorId,
        actor_role: entry.actorRole,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        ip_address: entry.ipAddress,
        metadata: entry.metadata,
      });

    if (error) {
      throw new DatabaseDomainError("AUDIT_LOG_FAILED", error.message, { code: error.code });
    }
  }
}

export const auditLogWriter = new AuditLogWriter();
