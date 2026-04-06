import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionsRouter from "./sessions";
import foldersRouter from "./folders";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionsRouter);
router.use(foldersRouter);

export default router;
