import { existsSync } from "fs";
import path from "path";
import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";

const app: Express = express();
const workspaceRoot = process.cwd();
const landingDist = path.resolve(workspaceRoot, "artifacts", "bevpro-landing", "dist", "public");
const voiceAgentDist = path.resolve(workspaceRoot, "artifacts", "voice-agent-pwa", "dist");

app.use(cors());
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
