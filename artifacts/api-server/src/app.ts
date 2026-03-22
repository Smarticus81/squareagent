import { existsSync } from "fs";
import path from "path";
import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";

const app: Express = express();
const workspaceRoot = process.cwd();
const landingDist = path.resolve(workspaceRoot, "artifacts", "bevpro-landing", "dist", "public");
const voiceAgentDist = path.resolve(workspaceRoot, "artifacts", "voice-agent-pwa", "dist");

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
