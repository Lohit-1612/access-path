import os
import pytest
from pathlib import Path

# Force isolated fast SQLite database for automated unit test suites
BASE_DIR = Path(__file__).resolve().parent.parent
test_db = BASE_DIR / "accesspath_test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{test_db}"

# Re-evaluate config setting
from api.config import settings
settings.DATABASE_URL = f"sqlite:///{test_db}"

@pytest.fixture(scope="session", autouse=True)
def cleanup_test_db():
    yield
    if test_db.exists():
        try:
            test_db.unlink()
        except Exception:
            pass
