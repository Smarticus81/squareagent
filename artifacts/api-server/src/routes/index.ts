import { Router, type IRouter } from "express";
import healthRouter from "./health";
import voiceRouter from "./voice";
import squareRouter from "./square";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/voice", voiceRouter);
router.use("/square", squareRouter);

export default router;
