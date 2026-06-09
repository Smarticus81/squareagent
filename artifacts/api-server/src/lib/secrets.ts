/**
 * Symmetric encryption-at-rest for user-supplied secrets (Resend API keys,
 * SMTP passwords, external Postgres connection strings).
 *
 * Format: `enc:v1:<iv_b64>:<ciphertext_b64>:<tag_b64>` (AES-256-GCM).
 *
 * Key derivation: HMAC-SHA256 of SECRETS_ENCRYPTION_KEY, or ENCRYPTION_KEY
 * for compatibility with the deployment checklist. Production must provide
 * a dedicated 32+ character encryption key. Development may fall back to
 * JWT_SECRET, then to a local-only default.
 *
 * `decrypt()` is forgiving: if the value is not in the `enc:v1:` format we
 * assume it is a legacy plaintext value and return it unchanged. This lets us
 * roll out encryption without a backfill migration.
 */
import crypto from "node:crypto";

const explicitKey = process.env.SECRETS_ENCRYPTION_KEY?.trim();
const legacyExplicitKey = process.env.ENCRYPTION_KEY?.trim();
const fallbackKey = process.env.JWT_SECRET?.trim();
const DEV_KEY_SOURCE = "voycelab-default-dev-key-do-not-use-in-prod";
const KEY_SOURCE = explicitKey || legacyExplicitKey || fallbackKey || DEV_KEY_SOURCE;

if (process.env.NODE_ENV === "production") {
  const productionExplicitKey = explicitKey || legacyExplicitKey;
  if (!productionExplicitKey || productionExplicitKey.length < 32) {
    throw new Error(
      "[secrets] Refusing to start: set SECRETS_ENCRYPTION_KEY or ENCRYPTION_KEY to a dedicated 32+ character random value in production.",
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
  if (!stored.startsWith(PREFIX)) return stored;
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
