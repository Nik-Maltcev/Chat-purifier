import { spawn } from "child_process";
import path from "path";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ---------------------------------------------------------------------------
// Start Python Telethon worker as a child process
// ---------------------------------------------------------------------------
function startPythonWorker(): void {
  const workerDir = path.resolve(process.cwd(), "python-worker");
  const workerPort = process.env["TELEGRAM_WORKER_PORT"] ?? "8001";

  const child = spawn("python3", ["worker.py"], {
    cwd: workerDir,
    env: {
      ...process.env,
      WORKER_PORT: workerPort,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (data: Buffer) => {
    // Python worker logs are JSON — forward to Node logger
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      logger.info({ source: "python-worker" }, line);
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      logger.error({ source: "python-worker" }, line);
    }
  });

  child.on("exit", (code, signal) => {
    logger.error({ code, signal }, "Python worker exited — restarting in 5s");
    setTimeout(startPythonWorker, 5000);
  });

  child.on("error", (err) => {
    logger.error({ err }, "Failed to start Python worker");
  });

  logger.info({ workerDir, workerPort }, "Python worker started");
}

// Only start the worker if DATABASE_URL is set (required by python worker)
if (process.env["DATABASE_URL"]) {
  startPythonWorker();
} else {
  logger.warn("DATABASE_URL not set — Python worker will not start");
}

// ---------------------------------------------------------------------------
// Start Express server
// ---------------------------------------------------------------------------
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
