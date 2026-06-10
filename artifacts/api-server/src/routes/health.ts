import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { secretsEncryptionStatus } from "../lib/secrets";
import { readServerApiKeyReadiness } from "../lib/api-keys";
import { requireAuth } from "./auth";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz/config", requireAuth as any, (req, res) => {
  if (!(req as any).isAdmin) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const apiKeys = readServerApiKeyReadiness();
  res.json({
    status: "ok",
    nodeEnv: process.env.NODE_ENV ?? "development",
    publicBaseUrlConfigured: Boolean(process.env.PUBLIC_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    jwtSecretConfigured: Boolean(process.env.JWT_SECRET),
    secretsEncryption: secretsEncryptionStatus(),
    providers: {
      openai: apiKeys.openai,
      gemini: apiKeys.gemini,
    },
    billing: {
      clerkPublishableKeyConfigured: Boolean(process.env.VITE_CLERK_PUBLISHABLE_KEY),
      clerkSecretKeyConfigured: Boolean(process.env.CLERK_SECRET_KEY),
      clerkWebhookSecretConfigured: Boolean(process.env.CLERK_WEBHOOK_SECRET),
    },
    square: {
      applicationIdConfigured: Boolean(process.env.SQUARE_APPLICATION_ID),
      applicationSecretConfigured: Boolean(process.env.SQUARE_APPLICATION_SECRET),
    },
  });
});

export default router;
