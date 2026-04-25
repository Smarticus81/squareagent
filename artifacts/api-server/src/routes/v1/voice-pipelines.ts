import { Router, type Request, type Response } from "express";
import { v1 } from "@workspace/api-zod";
import {
  getAllPipelineAvailability,
  readVoicePipelineEnvCredentials,
} from "../../voice-pipelines";
import { recommendVoicePipeline } from "@workspace/voicelab-core/voice-pipeline";
import { listVoicePipelineProviders } from "@workspace/voicelab-core/voice-pipeline";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  const reports = await getAllPipelineAvailability();
  const meta = listVoicePipelineProviders();
  const enriched = reports.map((r) => {
    const m = meta.find((x) => x.provider === r.provider);
    return {
      ...r,
      shortDescription: m?.shortDescription,
      recommendedFor: m?.recommendedFor ?? [],
      requiredCredentials: m?.requiredCredentials ?? [],
      isFallback: m?.isFallback ?? false,
      isExperimental: m?.isExperimental ?? false,
      notes: m?.notes,
    };
  });
  res.json({ pipelines: enriched });
});

router.post("/recommend", (req: Request, res: Response) => {
  const parsed = v1.RecommendVoicePipelineRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "invalid_request", message: parsed.error.message } });
    return;
  }
  const result = recommendVoicePipeline({
    ...parsed.data,
    availableCredentials: readVoicePipelineEnvCredentials(),
  });
  res.json(result);
});

export default router;
