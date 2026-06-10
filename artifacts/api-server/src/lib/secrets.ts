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

const DEV_KEY_SOURCE = "voycelab-default-dev-key-do-not-use-in-prod";
type SecretKeySource = "SECRETS_ENCRYPTION_KEY" | "ENCRYPTION_KEY" | "JWT_SECRET" | "dev_default";

function keyStatus() {
  const explicitKey = process.env.SECRETS_ENCRYPTION_KEY?.trim();
  const legacyExplicitKey = process.env.ENCRYPTION_KEY?.trim();
  const fallbackKey = process.env.JWT_SECRET?.trim();
  const productionExplicitKey = explicitKey || legacyExplicitKey;
  const source: SecretKeySource = explicitKey
    ? "SECRETS_ENCRYPTION_KEY"
    : legacyExplicitKey
    ? "ENCRYPTION_KEY"
    : fallbackKey
    ? "JWT_SECRET"
    : "dev_default";

  return {
    configured: Boolean(explicitKey || legacyExplicitKey),
    source,
    productionReady: Boolean(productionExplicitKey && productionExplicitKey.length >= 32),
    keySource: productionExplicitKey || fallbackKey || DEV_KEY_SOURCE,
  };
}

export function secretsEncryptionStatus(): {
  configured: boolean;
  source: "SECRETS_ENCRYPTION_KEY" | "ENCRYPTION_KEY" | "JWT_SECRET" | "dev_default";
  productionReady: boolean;
  message?: string;
} {
  const status = keyStatus();
  return {
    configured: status.configured,
    source: status.source,
    productionReady: status.productionReady,
    message: status.productionReady
      ? undefined
      : "Set SECRETS_ENCRYPTION_KEY or ENCRYPTION_KEY to a dedicated 32+ character random value in production.",
  };
}

export function assertSecretsEncryptionKey(): void {
  if (process.env.NODE_ENV !== "production") return;
  const status = secretsEncryptionStatus();
  // Accept JWT_SECRET as a valid fallback key so existing deployments that
  // have not yet set a dedicated SECRETS_ENCRYPTION_KEY can still start.
  const hasFallbackKey = Boolean(process.env.JWT_SECRET?.trim());
  if (!status.productionReady && !hasFallbackKey) {
    throw new Error(`[secrets] Refusing to start: ${status.message}`);
  }
  if (!status.productionReady && hasFallbackKey) {
    console.warn(
      "[secrets] WARN: using JWT_SECRET as encryption key fallback. " +
      "Set SECRETS_ENCRYPTION_KEY to a dedicated 32+ character value for production security."
    );
  }
}

const PREFIX = "enc:v1:";

function encryptionKey(): Buffer {
  return crypto.createHmac("sha256", keyStatus().keySource).update("voycelab-secrets-v1").digest();
}

export function encrypt(plain: string): string {
  if (typeof plain !== "string" || plain.length === 0) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
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
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
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
