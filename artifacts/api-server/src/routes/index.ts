import { Router, type IRouter } from "express";
import healthRouter from "./health";
import voiceRouter from "./voice";
import squareRouter from "./square";
import authRouter from "./auth";
import venuesRouter from "./venues";
import realtimeRouter from "./realtime";
import realtimeInventoryRouter from "./realtime-inventory";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/voice", voiceRouter);
router.use("/square", squareRouter);
router.use("/venues", venuesRouter);
router.use("/realtime", realtimeRouter);
router.use("/realtime-inventory", realtimeInventoryRouter);

export default router;
