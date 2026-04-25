import { Router, type IRouter } from "express";
import healthRouter from "./health";
import voiceRouter from "./voice";
import squareRouter from "./square";
import authRouter from "./auth";
import venuesRouter from "./venues";
import realtimeRouter from "./realtime";
import subscriptionsRouter from "./subscriptions";
import v1Router from "./v1";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/voice", voiceRouter);
router.use("/square", squareRouter);
router.use("/venues", venuesRouter);
router.use("/realtime", realtimeRouter);
router.use("/subscriptions", subscriptionsRouter);
router.use("/v1", v1Router);

export default router;
