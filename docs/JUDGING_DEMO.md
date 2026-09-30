# AccessPath: 5-Minute Judging Demonstration Script
**VECTOR HACKS 26 &bull; Problem Statement VH-S03**

This script outlines the exact live demonstration sequence specified on **Page 13** of the VH-S03 problem analysis document.

---

## Preparation
1. Start the application:
   ```bash
   python run_project.py
   ```
2. Open two browser windows side-by-side at `http://localhost:5173`:
   - **Window 1 (User / Navigation Session)**: Keep on the **Plan Journey** tab.
   - **Window 2 (Moderation / Verifier Session)**: Switch to the **Verifier Queue** tab.
3. Click the **"Reset Demo"** button on the top demo bar to ensure clean initial state (Revision #1).

---

## Step-by-Step Demonstration Walkthrough

### Act 1: Shortest Path vs. User Constraints (0:00 – 0:40)
- **Action**: In the top demo bar, click **"1. Shortest 500m (Stairs)"** (or select "Pedestrian" profile and click "Calculate Accessible Route").
- **What to show**:
  - The map highlights the central direct route from North Gate to Main Library.
  - Actual distance: **500 m**.
  - Route passes down Great Hall Flight of Stairs (18 stone steps).
- **Talking Point for Judges**:
  > *"Conventional navigation engines choose the shortest distance. However, for a wheelchair user or someone with limited mobility, this 500m path is an absolute dead-end because of an 18-step staircase."*

---

### Act 2: Constrained Routing for Wheelchair Profile (0:40 – 1:20)
- **Action**: Click **"2. Wheelchair 650m"** (or switch preset to "Wheelchair" with "Strictly Exclude Stairs" enabled).
- **What to show**:
  - Route dynamically switches to the **East Footpath / Tree Walk (Route B)**.
  - Actual distance: **650 m** (+150m longer, but 100% step-free).
  - Status banner displays: *"Surveyed Accessible Path: Recommended step-free route (650 m). All known barriers and stairs avoided."*
  - Evidence coverage reads **100% Verified**.
- **Talking Point for Judges**:
  > *"AccessPath applies hard constraint filtering before path optimization using NetworkX Dijkstra. Stairs are strictly pruned from the graph. The system recommends the 650m surveyed step-free East Footpath."*

---

### Act 3: Barrier Reporting & AI Candidate Detection (1:20 – 2:15)
- **Action**: Click **"3. Report Barrier + AI"** (or go to "Report Barrier" tab and select "East Footpath Construction Barricade").
- **What to show**:
  - The photo of the construction barricade is ingested with HTTP 202.
  - Candidate bounding boxes appear overlaid on the evidence photo with candidate confidence scores (e.g. `construction: 89%`).
  - Candidate edge selector highlights the nearest path segments (`e_east_blocked_segment`).
  - Reporter confirms the label and marks obstruction as **"Complete Blockage"**.
- **Talking Point for Judges**:
  > *"When an obstacle is found, the user takes a photo. Our OWLv2 object detection model identifies candidate obstruction types and bounding boxes. Crucially, as required by VH-S03, human evidence confirms the candidate tag and binds it to the exact pedestrian corridor within a metric radius. Model output never certifies or closes a path autonomously."*

---

### Act 4: Verifier Approval & Real-Time Rerouting (2:15 – 3:05)
- **Action**: Click **"4. Verify → Detour 720m"** (or in Window 2, click "Verify Active" with an audit note).
- **What to show**:
  - In Window 2 (Verifier), the barrier status turns to **Verified Active**, and the graph revision increments to **Rev #2**.
  - **In Window 1 (User Session)**: Without refreshing the page, the route instantly updates via Server-Sent Events (SSE)!
  - The revised route diverts to **Route C (West Ramp Way / Innovation Walk)**.
  - Distance: **720 m** (+70m detour over previous route).
  - Detour explanation banner clearly explains:
    > *"Route changed because construction blocks East Footpath Tree Walkway. The alternative is 720 m, avoiding all blocked segments."*
- **Talking Point for Judges**:
  > *"Notice Window 1 updated live via Server-Sent Events without reloading. The system explains exactly why the detour occurred—construction on the east path—and routed through the West Innovation Ramp (+70m detour)."*

---

### Act 5: Clearance Verification & Route Restoration (3:40 – 4:20)
- **Action**: Click **"5. Resolve → Restore 650m"** (or in Verifier Queue, click "Verify Clearance").
- **What to show**:
  - Verifier records inspection clearance: *"Work completed; barrier removed."*
  - Graph revision increments to **Rev #3**.
  - Window 1 automatically restores the route back to the original **650 m East Footpath**!
- **Talking Point for Judges**:
  > *"Barriers have a complete lifecycle. Once campus facilities clear the obstruction, the clearance is verified and eligibility is restored immediately across all client sessions."*

---

### Act 6: Honest "No Route" Failure State (4:20 – 5:00)
- **Action**: Click **"6. Block All → No Route"**.
- **What to show**:
  - Both step-free routes (B and C) are blocked by active construction.
  - The application returns **`status: "no_route"`**.
  - Status banner displays: *"No route found meeting the selected constraints. Key step-free paths are blocked by active verified barriers. Incompatible segments with stairs were strictly excluded."*
- **Talking Point for Judges**:
  > *"A critical requirement of VH-S03 is that the system must handle failure honestly. Rather than quietly routing the wheelchair user back through the dangerous 18-step staircase or inventing fake straight lines across buildings, AccessPath provides a transparent 'no route' result with unsatisfied constraints."*

---

## Answers to Likely Judge Questions

1. **Where is the AI?**
   > *In text-conditioned visual candidate detection (OWLv2). Routing uses exact graph algorithms and explicit mathematical constraints, which is far more reliable and auditable than relying on an LLM for navigation.*

2. **What if the AI makes a false detection?**
   > *Candidate detections remain unverified drafts. Only human verification through the review queue can alter the graph state.*

3. **Why a localized campus network instead of the entire city?**
   > *Standard navigation APIs (Google Maps, OpenStreetMap) do not know if a 2-inch curb or a flight of stairs exists between two points. A surveyed, ground-truthed campus pedestrian network allows complete verification of entrances, curb cuts, ramp slopes, and live dynamic rerouting.*
