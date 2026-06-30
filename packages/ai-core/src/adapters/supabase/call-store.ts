import crypto from "node:crypto";
import type { ICallStore, Call } from "../../core/ports.js";
import { CallSchema } from "../../core/ports.js";
import { supabaseServiceClient } from "./client.js";
import { DatabaseDomainError } from "../../core/errors.js";
import { fieldEncryption } from "../encryption/field-encryption.js";
import { auditLogWriter } from "./audit-log.js";

export class SupabaseCallStore implements ICallStore {
  async create(call: Omit<Call, "id" | "createdAt">): Promise<Call> {
    // We need to generate an ID first for encryption (since we need rowId)
    const id = crypto.randomUUID();
    const callWithId = { ...call, id };
    const encryptedCall = fieldEncryption.encryptObject(
      callWithId as Record<string, unknown>,
      id,
      ["transcriptJson"],
      "call"
    );

    const { data, error } = await supabaseServiceClient
      .from("calls")
      .insert(this.camelToSnake(encryptedCall as Record<string, unknown>))
      .select("*")
      .single();

    if (error) {
      throw new DatabaseDomainError("CALL_CREATE_FAILED", error.message, { code: error.code });
    }

    const camelData = this.snakeToCamel(data);
    const decryptedData = fieldEncryption.decryptObject(
      camelData as Record<string, unknown>,
      data.id,
      ["transcriptJson"],
      "call"
    );

    await auditLogWriter.log({
      action: "CREATE",
      entityType: "call",
      entityId: id,
    });
    return CallSchema.parse(decryptedData);
  }

  async appendTranscript(callId: string, chunk: Record<string, unknown>): Promise<void> {
    // First get current (encrypted) transcript, decrypt it, append, then encrypt again
    const { data: currentCall } = await supabaseServiceClient
      .from("calls")
      .select("transcript_json")
      .eq("id", callId)
      .single();

    let currentTranscript: Record<string, unknown> = {};
    if (currentCall?.transcript_json) {
      // Decrypt
      const decrypted = fieldEncryption.decrypt(
        currentCall.transcript_json as string,
        callId,
        "call"
      );
      try {
        currentTranscript = JSON.parse(decrypted);
      } catch {
        currentTranscript = {};
      }
    }

    const updatedTranscript = {
      ...currentTranscript,
      ...chunk,
    };

    const encryptedTranscript = fieldEncryption.encrypt(
      JSON.stringify(updatedTranscript),
      callId,
      "call"
    );

    const { error } = await supabaseServiceClient
      .from("calls")
      .update({ transcript_json: encryptedTranscript })
      .eq("id", callId);

    if (error) {
      throw new DatabaseDomainError("TRANSCRIPT_APPEND_FAILED", error.message, { code: error.code });
    }

    await auditLogWriter.log({
      action: "UPDATE",
      entityType: "call",
      entityId: callId,
    });
  }

  async finalize(callId: string, summary: string): Promise<Call> {
    const { data, error } = await supabaseServiceClient
      .from("calls")
      .update({ summary })
      .eq("id", callId)
      .select("*")
      .single();

    if (error) {
      throw new DatabaseDomainError("CALL_FINALIZE_FAILED", error.message, { code: error.code });
    }

    const camelData = this.snakeToCamel(data);
    const decryptedData = fieldEncryption.decryptObject(
      camelData as Record<string, unknown>,
      data.id,
      ["transcriptJson"],
      "call"
    );

    await auditLogWriter.log({
      action: "UPDATE",
      entityType: "call",
      entityId: callId,
    });
    return CallSchema.parse(decryptedData);
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
