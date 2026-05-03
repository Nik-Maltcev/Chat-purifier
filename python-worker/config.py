import os
import sys

DATABASE_URL: str = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL environment variable is required", file=sys.stderr)
    sys.exit(1)

WORKER_PORT: int = int(os.environ.get("WORKER_PORT", "8001"))
LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "INFO").upper()
