# AccessPath: Dynamic Accessibility Barrier Detection and Routing
## Technical Setup and Execution Guide (Vector Hacks VH-S03)

### 1. Overview
AccessPath is a dynamic accessibility prototype that identifies physical barriers (stairs, construction, damaged surfaces, missing ramps, blocked walkways), validates reports via human verification, atomically updates a pedestrian graph, and recommends routes meeting explicit mobility constraints (wheelchair, limited mobility, low vision).

### 2. Prerequisites
- **Python**: 3.11+
- **Node.js**: 18+ (tested with Node v24)
- **Dependencies**:
  - Python: `fastapi`, `uvicorn`, `networkx`, `shapely`, `pydantic`, `pillow`, `sse-starlette`, `pytest`, `httpx`
  - Web: React 19, TypeScript, Vite, Tailwind CSS v4, Leaflet, Lucide Icons

### 3. Quick Start (Single Command)
Run the root orchestrator from the project directory:
```bash
python run_project.py
```
This automatically:
1. Verifies/seeds the SQLite campus graph database with calibrated 500m/650m/720m benchmark fixtures.
2. Generates the sample images.
3. Starts the FastAPI backend on `http://127.0.0.1:8000`.
4. Starts the Vite frontend on `http://localhost:5173`.
5. Connects the live Server-Sent Events (SSE) stream for real-time multi-browser route updates.

---

### 4. Manual Component Startup

#### Backend API:
```bash
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload
```
API Documentation will be live at: `http://127.0.0.1:8000/docs`

#### Background Inference Worker:
```bash
python -m worker.job_runner
```

#### Frontend Client:
```bash
cd web
npm run dev
```
Open `http://localhost:5173` in your browser.

---

### 5. Running Automated Validation Tests
Run the comprehensive test suite verifying hard constraints, dynamic rerouting, optimistic concurrency, and health checks:
```bash
python -m pytest tests -v
```
All 12 automated test invariants will execute and pass.
