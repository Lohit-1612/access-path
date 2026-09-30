# AccessPath System Architecture & Design Specification
**VECTOR HACKS 26 &bull; Track VH-S03: Accessibility Barrier Detection and Routing**

---

## 1. Executive Architecture Summary
AccessPath is an end-to-end accessibility platform designed to solve the critical gap between standard navigation engines and real-world pedestrian mobility barriers. 

```
                                      ┌──────────────────────┐
                                      │   Web Client (SPA)   │
                                      │ React + TS + Leaflet │
                                      └──────────┬───────────┘
                                                 │ REST & SSE
                                                 ▼
                                      ┌──────────────────────┐
                                      │  FastAPI Application │
                                      │  - Graph & Routing   │
                                      │  - Report Lifecycle  │
                                      │  - Revision Outbox   │
                                      └──────────┬───────────┘
                         ┌───────────────────────┴───────────────────────┐
                         ▼                                               ▼
              ┌─────────────────────┐                         ┌─────────────────────┐
              │ SQLite / PostgreSQL │                         │  Inference Worker   │
              │ - Spatial Pedestrian│                         │ - OWLv2 Detector    │
              │ - Barrier Audit Log │                         │ - Privacy Stripper  │
              │ - Leased Jobs Queue │                         │ - Job Poller/Leaser │
              └─────────────────────┘                         └─────────────────────┘
```

---

## 2. Core Subsystems

### 2.1 Spatial Pedestrian Graph & Routing (NetworkX Dijkstra)
- **Nodes**: Junctions, crossings, kerb transitions, and accessible entrance doors.
- **Edges**: Directed traversable pedestrian paths storing geometry, length in metres, stairs flag (`stairs=True/False`), width, slope percentage, surface type, and survey timestamp.
- **Constrained Routing Algorithm**:
  1. **Exclusion Filter**: Exclude edges based on mobility profile constraints before optimization:
     - Wheelchair profile strictly excludes all segments with `stairs == True`.
     - Completely blocked segments (`extent == "complete"` from `verified_active` or strict `pending` reports) are removed.
     - Segments with `width_m < min_width_m` or `slope_pct > max_slope_pct` are removed.
  2. **Non-negative Preference Cost Function**:
     $$\text{edge\_cost\_m} = \text{length\_m} + \text{rough\_penalty\_m} + \text{slope\_penalty\_m} + \text{crossing\_penalty\_m} + \text{uncertainty\_penalty\_m}$$
     - These penalties represent preference in equivalent metres, not physical distance.
     - Dijkstra calculates the optimal path with zero negative-cycle risks.
     - Actual distance is calculated and reported separately from routing cost.
  3. **Evidence Coverage Metric**:
     $$\text{Evidence Coverage} = \frac{\sum \text{Checked Segment Lengths}}{\text{Total Route Length}}$$

### 2.2 Worked Example Invariants
As specified in Page 7 & 13 of the technical specification:
| Route Scenario | Actual Distance | Mobility Mode | Result / Behavior |
| :--- | :--- | :--- | :--- |
| **Path A (Central Quad via Great Hall)** | 500 m | Pedestrian / Standard | Selected (contains 18-step stairway). |
| **Path A** | 500 m | Wheelchair | **Strictly excluded** due to stairs constraint. |
| **Path B (East Footpath / Tree Walk)** | 650 m | Wheelchair | **Initially selected** (step-free, surveyed). |
| **Path B Blocked (Construction)** | N/A | Wheelchair | B excluded after verified report. |
| **Path C (West Ramp Way / Innovation)** | 720 m | Wheelchair | **Dynamically selected** (+70m detour over Path B). |
| **Path B & Path C Blocked** | N/A | Wheelchair | Returns honest `status: "no_route"`; does not quietly reintroduce stairs! |

---

## 3. Spatial Matching & Evidence Lifecycle (Section 8)

### 3.1 Spatial Edge Matching (ST_DWithin Equivalent)
GPS drift often attaches photos to the wrong side of a road or barrier. When a user drops a pin:
- The system queries candidate edges within a metric radius (15m to 35m).
- Distances from the pin to candidate LineStrings are calculated using equirectangular projection and Haversine metric distances (never treating degrees as metres).
- Candidate edges are presented to the reporter or verifier with distances and node labels to confirm the exact affected corridor.

### 3.2 Barrier State Machine
```
   [ Photo Captured ]
           │
           ▼
        [ Draft ] ──(HTTP 202 Async OWLv2 Detection)
           │
           ▼
       [ Pending ] ──(Reporter confirms candidate boxes & affected edge)
        │       │
(Verify)│       │(Reject)
        ▼       ▼
 [ Verified Active ]  [ Rejected ]
        │       ▲
(Resolve)│       │(Reopen observation)
        ▼       │
   [ Resolved ] ─┘
```

---

## 4. AI Barrier Detection Pipeline (OWLv2)
- **Model**: `google/owlv2-base-patch16` (Apache 2.0 license).
- **Text Queries**:
  - `stairs or steps`
  - `a construction barricade`
  - `a pothole or broken pavement`
  - `a parked motorcycle or scooter`
  - `temporary construction fence or debris`
- **Privacy Enforcement**:
  - Image decoded, EXIF metadata stripped immediately upon ingestion (preventing location/device leakage and unapproved faces/plates).
  - Images stored in private local volume; accessed only via authenticated `/api/media/{id}`.
- **Asynchronous Decoupling**:
  - Ingestion returns `HTTP 202 Accepted` with `job_id`.
  - Background worker claims jobs with database lease timeouts.
  - Human validation is always required before graph updates are published.

---

## 5. Concurrency & Real-Time Synchronization
- **Optimistic Concurrency Control**:
  All moderation writes require `expected_version`. If a concurrent verifier edits a report simultaneously, the API responds with `HTTP 409 Conflict`.
- **Atomic Graph Revisions**:
  When a report is verified or cleared, the API updates the barrier state and increments `graph_state.revision` in an atomic database transaction.
- **Server-Sent Events (SSE)**:
  Clients listen on `/api/events`. When `revision` increments, an event is pushed, causing all open client sessions to automatically refetch and display rerouted paths in real-time.

---

## 6. Accessibility (WCAG 2.2) Compliance
- Visible keyboard focus rings (`focus-visible:ring-2 focus-visible:ring-blue-600`).
- Minimum touch target sizes exceeding 44x44 CSS pixels for all primary actions.
- Map representations accompanied by ordered, turn-by-turn text equivalent views.
- Voice synthesis turn-by-turn guidance with explicit user-initiated Start and Stop controls.
- Screen reader announcements using polite ARIA live regions (`aria-live="polite"`).
