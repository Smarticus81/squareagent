import { Router, type IRouter } from "express";
import healthRouter from "./health";
import voiceRouter from "./voice";
import squareRouter from "./square";
import authRouter from "./auth";
import venuesRouter from "./venues";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/voice", voiceRouter);
router.use("/square", squareRouter);
router.use("/venues", venuesRouter);

export default router;
