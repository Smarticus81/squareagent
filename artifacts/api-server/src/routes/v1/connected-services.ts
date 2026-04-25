import { Router, type Request, type Response } from "express";
import { listConnectedServiceProviders } from "@workspace/voicelab-core/connected-service";
import { listImplementedProviders } from "../../connectors";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  const all = listConnectedServiceProviders();
  const implemented = new Set(listImplementedProviders());
  const providers = all.map((p) => ({
    ...p,
    /** Honest status: even if metadata says "available", confirm an adapter exists. */
    status: implemented.has(p.provider) ? p.status : p.status === "available" ? "needs_configuration" : p.status,
    isImplemented: implemented.has(p.provider),
  }));
  res.json({ providers });
});

export default router;
