import os
import sys
from pathlib import Path

# Add project root to sys.path so 'api', 'data', 'worker' are resolvable by Vercel
root_dir = str(Path(__file__).resolve().parent.parent)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

# Ensure Cython is disabled if running on restricted environments
os.environ.setdefault("DISABLE_SQLALCHEMY_CEXT", "1")

# Make sure tables and seed data exist on serverless boot
try:
    from api.database import init_db
    from api.repository import repo
    from data.seed_data import seed_database
    init_db()
    if not repo.get_all_nodes():
        seed_database()
except Exception as e:
    print(f"[Vercel Init] Database pre-seed note: {e}")

from api.main import app
