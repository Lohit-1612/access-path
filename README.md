# AccessPath ♿
### Dynamic Accessibility Barrier Detection and Routing Prototype
**Vector Hacks 26 &bull; Problem Statement Track: VH-S03**

---

## 📌 Project Summary
**AccessPath** is an end-to-end accessible navigation platform built for campuses and neighbourhoods. Conventional navigation tools (Google Maps, OpenStreetMap) only consider road geometry and cannot account for real-world physical barriers—such as a single flight of stairs, a missing curb cut, construction barricades, potholes, or steep slopes. For wheelchair users and people with limited mobility, a route is only as valid as its weakest segment.

AccessPath solves this by providing:
1. **Photo-based Barrier Detection**: Users report barriers with an evidence photo and location pin. Candidate object detector (OWLv2) locates barriers and bounding boxes with confidence scores.
2. **Human-in-the-Loop Moderation**: Bounding boxes and labels are confirmed by the reporter and verified by campus administrators before affecting published routes.
3. **Constrained NetworkX Routing**: NetworkX Dijkstra calculates optimal paths by strictly enforcing individual mobility profiles (e.g., Wheelchair Step-Free, Limited Mobility, Low Vision).
4. **Real-Time Dynamic Rerouting**: Atomic graph revisions broadcast updates via **Server-Sent Events (SSE)**, instantaneously updating route recommendations across connected browser sessions with human-intelligible detour explanations.
5. **Honest Failure Handling**: If all accessible routes are blocked, AccessPath transparently returns a `no_route` status detailing the violated constraints rather than quietly re-introducing stairs.

---

## 🚀 Live Demonstration Quickstart
To launch the full system (Backend API, Inference Worker, and React Frontend) with a single command:

```bash
python run_project.py
```

Once launched:
- **Interactive Web App**: [http://localhost:5173](http://localhost:5173)
- **FastAPI Documentation**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Health Check & Model Readiness**: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

---

## 🧭 The 5-Minute Judging Demonstration (VH-S03 Page 13)
The top header includes an interactive 1-click **Judging Demo Bar** that executes the complete test cycle:

1. **Shortest 500m Path (Stairs)**: Demonstrates that standard navigation routes through the Great Hall stairs (18 steps).
2. **Wheelchair 650m Route**: Demonstrates that the wheelchair profile prunes stairs and recommends the surveyed 650m step-free East Footpath.
3. **Report Barrier + AI**: Ingests a construction barrier photo on the East Footpath. Displays candidate bounding boxes and candidate edge snapping within a 35m search radius.
4. **Verify & Live Reroute to 720m**: Verifier approves the report. In any open user session, the route updates in real time via SSE to the 720m West Ramp (+70m detour) with an explicit explanation.
5. **Resolve & Restore 650m**: Verifier clears the barrier. Eligibility is restored and the original 650m route returns.
6. **Block All → Honest No Route**: Blocks all step-free alternatives. System returns `status: "no_route"` rather than sending the user down stairs.

---

## 🛠️ Technology Stack
| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Interface** | React 19 + TypeScript + Vite | Accessible, responsive SPA with visible focus |
| **Map Rendering** | Leaflet + GeoJSON | Renders surveyed pedestrian network & barriers |
| **Styling** | Tailwind CSS v4 | WCAG 2.2 compliant target sizing (≥ 44px) |
| **Backend API** | FastAPI + Pydantic v2 | High-performance async REST API & SSE streaming |
| **Routing Engine** | NetworkX Dijkstra | Non-negative preference cost function & exclusions |
| **Database** | SQLite / PostgreSQL | Spatial LineStrings, audit trails, and revisions |
| **Inference Pipeline** | PyTorch + Transformers OWLv2 | Text-conditioned candidate barrier detection |
| **Validation** | pytest + TestClient | 12 automated tests for routing & API invariants |

---

## 🧪 Automated Testing
Run the comprehensive test suite verifying all invariants:
```bash
python -m pytest tests -v
```

---

## 📂 Repository Structure
```
vector-hacks/
├── api/
│   ├── config.py              # Configuration & search radius parameters
│   ├── database.py            # SQLite / PostgreSQL database connection & tables
│   ├── repository.py          # Optimistic concurrency & atomic revisions
│   ├── routing.py             # NetworkX Dijkstra constrained router
│   ├── spatial.py             # Metric Haversine & segment snapping
│   ├── routes/                # Modular FastAPI route handlers
│   └── main.py                # FastAPI app entrypoint
├── worker/
│   ├── detector.py            # OWLv2 object detector with privacy stripping
│   └── job_runner.py          # Transactional job claiming & worker loop
├── data/
│   ├── seed_data.py           # Calibrated 500m/650m/720m campus dataset
│   ├── generate_sample_images.py # Benchmark test images
│   └── sample_images/         # Construction, stairs, and pothole images
├── web/                       # React + TypeScript + Vite + Tailwind frontend
│   ├── src/
│   │   ├── components/        # JourneySetup, MapView, RouteView, ReviewQueue, DemoBar
│   │   ├── api.ts             # REST client & SSE listener
│   │   ├── types.ts           # Shared TypeScript models
│   │   └── App.tsx            # Main application orchestrator
├── tests/
│   ├── test_api.py            # API contracts & optimistic concurrency tests
│   └── test_routing.py        # Invariant & constraint verification tests
├── docs/
│   ├── SETUP.md               # Setup and execution guide
│   ├── ARCHITECTURE.md        # Technical architecture specification
│   └── JUDGING_DEMO.md        # 5-minute judging script with talking points
└── run_project.py             # Single-command launcher
```
