import os
from pathlib import Path
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
is_serverless = bool(os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME"))

if is_serverless:
    WRITABLE_DIR = Path("/tmp")
else:
    WRITABLE_DIR = BASE_DIR

UPLOAD_DIR = WRITABLE_DIR / "uploads"
try:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

try:
    (DATA_DIR / "sample_images").mkdir(parents=True, exist_ok=True)
except Exception:
    pass

# Load .env if present
env_file = BASE_DIR / ".env"
if env_file.exists():
    with open(env_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

DEFAULT_NEON_URL = "postgresql://neondb_owner:npg_E05shINcnYWH@ep-winter-thunder-b53c0oip.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require"

class Settings(BaseModel):
    PROJECT_NAME: str = "AccessPath - Dynamic Accessibility Barrier Detection and Routing"
    VERSION: str = "1.0.0"
    API_PREFIX: str = "/api"
    # Prioritise Neon PostgreSQL database URL; fallback to SQLite for isolated local offline unit tests
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        os.getenv("NEON_DATABASE_URL", DEFAULT_NEON_URL)
    )
    UPLOAD_DIR: Path = UPLOAD_DIR
    DATA_DIR: Path = DATA_DIR
    SEARCH_RADIUS_M: float = 15.0  # Metres search radius as required by VH-S03 spec
    MODEL_NAME: str = os.getenv("MODEL_NAME", "google/owlv2-base-patch16")
    USE_GPU: bool = os.getenv("USE_GPU", "false").lower() == "true"
    RECHECK_HOURS_MOVABLE: int = 2
    RECHECK_HOURS_CONSTRUCTION: int = 24
    RECHECK_DAYS_STRUCTURAL: int = 30

settings = Settings()
