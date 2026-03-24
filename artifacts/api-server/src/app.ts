import { existsSync } from "fs";
import path from "path";
import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import router from "./routes";

const app: Express = express();
const workspaceRoot = process.cwd();
const landingDist = path.resolve(workspaceRoot, "artifacts", "bevpro-landing", "dist", "public");
const voiceAgentDist = path.resolve(workspaceRoot, "artifacts", "voice-agent-pwa", "dist");

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

// ── Stripe webhook needs raw body — must be before json middleware
app.use("/api/subscriptions/webhook",
  express.raw({ type: "application/json" }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.use("/api/realtime", rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded. Please wait before starting a new session." },
}));

app.use("/api/realtime-inventory", rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded. Please wait before starting a new session." },
}));

app.use("/api", router);

if (existsSync(voiceAgentDist)) {
	app.use("/agent", express.static(voiceAgentDist, { index: false }));
	app.get(/^\/agent(?:\/.*)?$/, (_req, res) => {
		res.sendFile(path.join(voiceAgentDist, "index.html"));
	});
}

if (existsSync(landingDist)) {
	app.use(express.static(landingDist, { index: false }));
	app.get(/^(?!\/api(?:\/|$)|\/agent(?:\/|$)).*/, (_req, res) => {
		res.sendFile(path.join(landingDist, "index.html"));
	});
}

export default app;
