import { existsSync } from "fs";
import path from "path";
import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import { logger } from "./lib/logger";
import router from "./routes";
import { clerkBillingMiddleware } from "./lib/clerk-billing";

const app: Express = express();
const workspaceRoot = process.cwd();
const landingDist = path.resolve(workspaceRoot, "artifacts", "voycelab-landing", "dist", "public");
const voiceAgentDist = path.resolve(workspaceRoot, "artifacts", "voice-agent-pwa", "dist");

// ── Structured request logging
app.use(pinoHttp({ logger }));

// ── Security headers
app.use(helmet({
  contentSecurityPolicy: false, // SPA serves its own CSP via meta tags
  crossOriginEmbedderPolicy: false, // Required for WebRTC to function
}));

// In production restrict CORS to the configured public origin.
// In development allow all origins so Vite dev servers (ports 5173, 8081) work.
const publicOrigin =
  process.env.PUBLIC_BASE_URL ??
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);

app.use(
  cors(
    publicOrigin
      ? { origin: publicOrigin, credentials: true }
      : undefined,
  ),
);

// ── Clerk Billing webhook needs raw body — must be before json middleware
app.use("/api/subscriptions/webhook",
  express.raw({ type: "application/json" }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Clerk Billing middleware — silently attaches Clerk auth for billing checks
app.use(clerkBillingMiddleware());

// ── Rate limiters
app.use("/api/auth/login", rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in a minute." },
}));

app.use("/api/auth/signup", rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many signup attempts. Please try again later." },
}));

app.use("/api/auth/forgot-password", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reset requests. Try again in a few minutes." },
}));

// Session minting is the real abuse vector (it calls OpenAI), so keep a tight
// cap there. Tool calls + heartbeats during an active voice conversation are
// far more frequent and authenticated — a single busy ordering session can
// legitimately fire dozens per minute, so the old shared 30/min cap throttled
// real sessions and made the assistant appear to freeze. Split the buckets.
app.use(["/api/realtime/session"], rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.REALTIME_SESSION_RATE_MAX ?? 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded. Please wait before starting a new session." },
}));

app.use(["/api/realtime", "/api/realtime/gemini"], rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.REALTIME_RATE_MAX ?? 240),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded. Please slow down." },
}));

app.use("/api", router);

// Hashed Vite assets are immutable; index.html must always revalidate so a
// deploy doesn't leave clients holding a shell that points at purged chunks.
const staticOptions = {
	index: false as const,
	maxAge: "1y",
	immutable: true,
	setHeaders: (res: express.Response, filePath: string) => {
		if (filePath.endsWith(".html") || filePath.endsWith("sw.js") || filePath.endsWith("manifest.json")) {
			res.setHeader("Cache-Control", "no-cache");
		}
	},
};
const sendIndex = (res: express.Response, dist: string) => {
	res.setHeader("Cache-Control", "no-cache");
	res.sendFile(path.join(dist, "index.html"));
};

if (existsSync(voiceAgentDist)) {
	app.use("/agent", express.static(voiceAgentDist, staticOptions));
	app.get(/^\/agent(?:\/.*)?$/, (_req, res) => {
		sendIndex(res, voiceAgentDist);
	});
}

if (existsSync(landingDist)) {
	app.use(express.static(landingDist, staticOptions));
	app.get(/^(?!\/api(?:\/|$)|\/agent(?:\/|$)).*/, (_req, res) => {
		sendIndex(res, landingDist);
	});
}

export default app;
