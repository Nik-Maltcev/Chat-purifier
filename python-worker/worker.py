# Entry point for the Python worker.
# Run with: py worker.py
#
# The worker reads configuration from environment variables:
#   DATABASE_URL  — required, PostgreSQL connection string
#   WORKER_PORT   — optional, HTTP listen port (default: 8001)
#   LOG_LEVEL     — optional, logging level (default: INFO)

import uvicorn

from config import LOG_LEVEL, WORKER_PORT
from logger import configure_logging

if __name__ == "__main__":
    configure_logging(LOG_LEVEL)

    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=WORKER_PORT,
        log_level=LOG_LEVEL.lower(),
        reload=False,
    )
