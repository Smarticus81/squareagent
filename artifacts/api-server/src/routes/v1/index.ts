import { Router } from "express";
import voicePipelinesRouter from "./voice-pipelines";
import connectedServicesRouter from "./connected-services";
import agentProfilesRouter from "./agent-profiles";
import realtimeSessionsRouter from "./realtime-sessions";
import knowledgeRouter from "./knowledge";

const router = Router();

router.use("/voice-pipelines", voicePipelinesRouter);
router.use("/connected-service-providers", connectedServicesRouter);
router.use("/agent-profiles", agentProfilesRouter);
router.use("/realtime/sessions", realtimeSessionsRouter);
router.use("/knowledge", knowledgeRouter);

export default router;
