import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionsRouter from "./sessions";
import foldersRouter from "./folders";
import settingsRouter from "./settings";
import accountsRouter from "./accounts";
import { migrateLegacyAccountIfNeeded } from "../lib/migrate-legacy-account.js";
import { autoRestartSessions } from "../lib/auto-restart.js";

// Auto-migrate old settings-based Telegram creds to accounts table on first request
migrateLegacyAccountIfNeeded().catch(() => {});

// Auto-restart sessions that were running or auto-paused before server restart
// Small delay to let DB connections stabilize
setTimeout(() => autoRestartSessions().catch(() => {}), 3000);

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionsRouter);
router.use(foldersRouter);
router.use(settingsRouter);
router.use(accountsRouter);

export default router;
