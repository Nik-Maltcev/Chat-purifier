import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionsRouter from "./sessions";
import foldersRouter from "./folders";
import settingsRouter from "./settings";
import accountsRouter from "./accounts";
import { migrateLegacyAccountIfNeeded } from "../lib/migrate-legacy-account.js";

// Auto-migrate old settings-based Telegram creds to accounts table on first request
migrateLegacyAccountIfNeeded().catch(() => {});

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionsRouter);
router.use(foldersRouter);
router.use(settingsRouter);
router.use(accountsRouter);

export default router;
