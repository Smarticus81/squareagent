import { Router, type Request, type Response } from "express";
import { listConnectedServiceProviders } from "@workspace/voicelab-core/connected-service";
import { listImplementedProviders } from "../../connectors";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  const showMock =
    process.env.VOYCELAB_ENABLE_MOCK_CONNECTOR === "true" ||
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test";
  const showCustomRest = process.env.VOYCELAB_ENABLE_CUSTOM_REST_CONNECTOR === "true";
  const implemented = new Set(listImplementedProviders());
  const providers = listConnectedServiceProviders()
    .filter((provider) => implemented.has(provider.provider))
    .filter((provider) => showMock || provider.provider !== "mock")
    .filter((provider) => showCustomRest || provider.provider !== "generic_rest")
    .map((p) => ({
      ...p,
      isImplemented: true,
    }));
  res.json({ providers });
});

export default router;
