/**
 * Symmetric encryption-at-rest for user-supplied secrets (Resend API keys,
 * SMTP passwords, external Postgres connection strings).
 *
 * Format: `enc:v1:<iv_b64>:<ciphertext_b64>:<tag_b64>` (AES-256-GCM).
 *
 * Key derivation: HKDF-style HMAC-SHA256 of the SECRETS_ENCRYPTION_KEY env var
 * (or JWT_SECRET as a fallback so existing deployments keep working). No new
 * env var is strictly required.
 *
 * `decrypt()` is forgiving — if the value isn't in the `enc:v1:` format we
 * assume it's a legacy plaintext value and return it unchanged. This lets us
 * roll out encryption without a backfill migration.
 */
import crypto from "node:crypto";

const explicitKey = process.env.SECRETS_ENCRYPTION_KEY?.trim();
const fallbackKey = process.env.JWT_SECRET?.trim();
const KEY_SOURCE = explicitKey || fallbackKey || "voycelab-default-dev-key-do-not-use-in-prod";

if (process.env.NODE_ENV === "production") {
  if (!explicitKey) {
    // Don't crash boot — but make it loud. Operators should set a dedicated
    // SECRETS_ENCRYPTION_KEY so JWT_SECRET can be rotated independently.
    // eslint-disable-next-line no-console
    console.warn(
      "[secrets] SECRETS_ENCRYPTION_KEY is not set in production. " +
        "Falling back to JWT_SECRET — rotating JWT_SECRET will make all encrypted user secrets unreadable. " +
        "Set SECRETS_ENCRYPTION_KEY to a dedicated 32+ char random value.",
    );
  }
  if (KEY_SOURCE === "voycelab-default-dev-key-do-not-use-in-prod") {
    throw new Error(
      "[secrets] Refusing to start: neither SECRETS_ENCRYPTION_KEY nor JWT_SECRET is set in production.",
    );
  }
}

const KEY = crypto.createHmac("sha256", KEY_SOURCE).update("voycelab-secrets-v1").digest();

const PREFIX = "enc:v1:";

export function encrypt(plain: string): string {
  if (typeof plain !== "string" || plain.length === 0) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${ct.toString("base64")}:${tag.toString("base64")}`;
}

export function decrypt(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) return stored;
  try {
    const iv = Buffer.from(parts[0], "base64");
    const ct = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    return "";
  }
}

/** Returns true if the stored value looks like ciphertext we wrote. */
export function isEncrypted(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(PREFIX);
}
