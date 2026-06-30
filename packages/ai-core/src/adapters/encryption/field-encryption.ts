import crypto from "node:crypto";
import { getEnv } from "../../config/env-schema.js";

export class FieldEncryption {
  private masterKey: Buffer;
  private keyLength = 32;
  private saltLength = 16;
  private ivLength = 12;

  constructor() {
    const env = getEnv();
    this.masterKey = Buffer.from(env.ENCRYPTION_MASTER_KEY, "hex");
    if (this.masterKey.length !== this.keyLength) {
      throw new Error("ENCRYPTION_MASTER_KEY must be 64 hex characters (32 bytes)");
    }
  }

  private deriveKey(salt: Buffer, info: string): Buffer {
    const result = crypto.hkdfSync("sha256", this.masterKey, salt, Buffer.from(info), this.keyLength);
    return Buffer.from(result);
  }

  encrypt(plaintext: string, rowId: string, info: string): string {
    const salt = crypto.randomBytes(this.saltLength);
    const iv = crypto.randomBytes(this.ivLength);
    const key = this.deriveKey(salt, info);

    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv) as crypto.CipherGCM;
    let ciphertext = cipher.update(plaintext, "utf8", "base64");
    ciphertext += cipher.final("base64");
    const tag = cipher.getAuthTag().toString("base64");

    return [
      "v1",
      salt.toString("base64"),
      iv.toString("base64"),
      tag,
      ciphertext
    ].join(".");
  }

  decrypt(ciphertext: string, rowId: string, info: string): string {
    const parts = ciphertext.split(".");
    if (parts.length !== 5 || parts[0] !== "v1") {
      throw new Error("Invalid ciphertext format");
    }

    const [, saltB64, ivB64, tagB64, dataB64] = parts;
    const salt = Buffer.from(saltB64, "base64");
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const encryptedData = Buffer.from(dataB64, "base64");

    const key = this.deriveKey(salt, info);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv) as crypto.DecipherGCM;
    decipher.setAuthTag(tag);

    let plaintext = decipher.update(encryptedData);
    plaintext = Buffer.concat([plaintext, decipher.final()]);

    return plaintext.toString("utf8");
  }

  encryptObject(obj: Record<string, unknown>, rowId: string, fields: string[], info: string): Record<string, unknown> {
    const result: Record<string, unknown> = { ...obj };
    for (const field of fields) {
      const value = result[field];
      if (typeof value === "string") {
        result[field] = this.encrypt(value, rowId, info);
      } else if (typeof value === "object" && value !== null) {
        result[field] = this.encrypt(JSON.stringify(value), rowId, info);
      }
    }
    return result;
  }

  decryptObject(obj: Record<string, unknown>, rowId: string, fields: string[], info: string): Record<string, unknown> {
    const result: Record<string, unknown> = { ...obj };
    for (const field of fields) {
      const value = result[field];
      if (typeof value === "string" && value.startsWith("v1.")) {
        const decrypted = this.decrypt(value, rowId, info);
        try {
          result[field] = JSON.parse(decrypted);
        } catch {
          result[field] = decrypted;
        }
      }
    }
    return result;
  }
}

export const fieldEncryption = new FieldEncryption();
