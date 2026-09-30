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

class Settings(BaseModel):
    PROJECT_NAME: str = "AccessPath - Dynamic Accessibility Barrier Detection and Routing"
    VERSION: str = "1.0.0"
    API_PREFIX: str = "/api"
    # Allow SQLite by default for zero-setup local demo, /tmp for Vercel, or PostgreSQL/Neon connection string via env
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "sqlite:////tmp/accesspath.db" if is_serverless else f"sqlite:///{BASE_DIR / 'accesspath.db'}"
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
