from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.config import settings
from api.routes.route_endpoints import router as route_router
from api.routes.report_endpoints import router as report_router
from api.routes.barrier_endpoints import router as barrier_router
from api.routes.event_endpoints import router as event_router
from api.repository import repo
from worker.detector import detector
from data.seed_data import seed_database
import os

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure database is initialised
    from api.database import init_db
    init_db()
    nodes = repo.get_all_nodes()
    if not nodes:
        print("[Startup] Empty database detected. Seeding campus graph...")
        seed_database()
    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Vector Hacks VH-S03: Dynamic Accessibility Barrier Detection and Routing",
    lifespan=lifespan
)

# Enable CORS for frontend Vite development server and production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers under /api
app.include_router(route_router, prefix="/api")
app.include_router(report_router, prefix="/api")
app.include_router(barrier_router, prefix="/api")
app.include_router(event_router, prefix="/api")

@app.get("/api/health")
def health_check():
    """
    Service readiness check as specified in VH-S03 (Page 10):
    Checks API, database, and inference availability.
    """
    db_ok = False
    try:
        state = repo.get_graph_state()
        db_ok = True
    except Exception:
        db_ok = False

    return {
        "status": "healthy" if db_ok else "degraded",
        "api": "ready",
        "database": "connected" if db_ok else "error",
        "graph_revision": state.get("revision", 1) if db_ok else None,
        "inference": {
            "model": detector.model_name,
            "type": "owlv2_transformers" if detector.initialized else "owlv2_perceptual_fallback",
            "ready": True
        }
    }

@app.get("/")
def root():
    return {
        "message": "Welcome to AccessPath API - VH-S03 Accessibility Barrier Detection and Routing",
        "docs": "/docs",
        "health": "/api/health"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.main:app", host="127.0.0.1", port=8000, reload=True)
