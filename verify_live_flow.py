import urllib.request
import json
import sys

def post(url, data):
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

def get(url):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

BASE = "http://127.0.0.1:8000/api"

from data.seed_data import seed_database
seed_database()

print("=" * 60)
print("RUNNING VH-S03 HACKATHON COMPLETE SPECIFICATION FLOW")
print("=" * 60)

# 1. Initial State: Accessible Route B (650m, 0 stairs)
r1 = post(f"{BASE}/routes", {
    "origin_place_id": "place_north_gate",
    "destination_place_id": "place_main_library",
    "profile": {"max_incline_deg": 5.0, "avoid_stairs": True}
})
dist1 = r1["actual_length_m"]
print("[Phase 1: Initial Route Calculated]")
print(f"  Distance: {dist1} m | Steps: {len(r1['steps'])} | Turns: {r1.get('turn_count')}")
print(f"  Evidence: {r1.get('evidence_breakdown')}")
print(f"  Explanation: {r1.get('explanation')}")
assert dist1 == 650.0, f"Expected 650m, got {dist1}"

# 2. Barrier Detection & Submission by Citizen
b1 = post(f"{BASE}/barriers/mark", {
    "lat": 13.08388,
    "lon": 80.27173,
    "affected_edge_ids": ["e_east_blocked_segment_fwd"],
    "category": "construction",
    "notes": "Broken scaffolding on East Footpath Tree Walkway",
    "role": "reporter"
})
rep1_id = b1["report_id"]
status1 = b1["barrier_status"]
print("\n[Phase 2: Barrier Detected & Submitted by Citizen]")
print(f"  Report ID: {rep1_id} | Barrier Status: {status1}")
print(f"  Message: {b1['message']}")
assert status1 == "pending", f"Expected pending, got {status1}"

# 3. Dynamic Rerouting & Warning for Pending Barrier
r2 = post(f"{BASE}/routes", {
    "origin_place_id": "place_north_gate",
    "destination_place_id": "place_main_library",
    "profile": {"max_incline_deg": 5.0, "avoid_stairs": True}
})
dist2 = r2["actual_length_m"]
print("\n[Phase 3: Route Recalculated with Pending Barrier]")
print(f"  Distance: {dist2} m | Detour: +{dist2 - dist1} m")
print(f"  Reason Codes: {r2['reason_codes']}")
print(f"  Explanation: {r2['explanation']}")
assert dist2 == 720.0, f"Expected 720m detour, got {dist2}"
assert "UNVERIFIED_BLOCKAGE_AVOIDED" in r2["reason_codes"]

# 4. Verifier Reviews & Confirms Active Barrier
b_verified = post(f"{BASE}/barriers/mark", {
    "lat": 13.08388,
    "lon": 80.27173,
    "affected_edge_ids": ["e_east_blocked_segment_fwd"],
    "category": "construction",
    "notes": "Confirmed scaffolding blocking wheelchair access",
    "role": "verifier"
})
ver_id = b_verified["report_id"]
status_ver = b_verified["barrier_status"]
print("\n[Phase 4: Barrier Verified by Campus Verifier]")
print(f"  Report ID: {ver_id} | Barrier Status: {status_ver}")
print(f"  Message: {b_verified['message']}")
assert status_ver == "verified_active", f"Expected verified_active, got {status_ver}"

# 5. Route Updated with Verified Detour & Audit
r3 = post(f"{BASE}/routes", {
    "origin_place_id": "place_north_gate",
    "destination_place_id": "place_main_library",
    "profile": {"max_incline_deg": 5.0, "avoid_stairs": True}
})
dist3 = r3["actual_length_m"]
print("\n[Phase 5: Route Recalculated with Verified Barrier]")
print(f"  Distance: {dist3} m")
print(f"  Reason Codes: {r3['reason_codes']}")
print(f"  Explanation: {r3['explanation']}")
assert dist3 == 720.0, f"Expected 720m detour, got {dist3}"
assert "BLOCKED_EDGE_AVOIDED" in r3["reason_codes"]

# 6. Citizen Reports Cleared & Verifier Confirms Resolution
c_clear = post(f"{BASE}/barriers/{ver_id}/report-cleared", {
    "reporter_name": "Citizen Walker",
    "notes": "Workers finished and sidewalk reopened",
    "role": "reporter"
})
print("\n[Phase 6a: Citizen Reports Pathway Cleared]")
print(f"  Message: {c_clear['message']}")

v_clear = post(f"{BASE}/barriers/{ver_id}/report-cleared", {
    "reporter_name": "Dr. Sarah Miller",
    "notes": "Field inspection verified clearance of scaffolding",
    "role": "verifier"
})
print("\n[Phase 6b: Verifier Confirms Resolution]")
print(f"  Message: {v_clear['message']}")

# Also resolve the initial pending report
post(f"{BASE}/barriers/{rep1_id}/report-cleared", {
    "reporter_name": "Dr. Sarah Miller",
    "notes": "Resolved initial pending report",
    "role": "verifier"
})

# 7. Pathway Restored: Back to Optimal Route B (650m)
r4 = post(f"{BASE}/routes", {
    "origin_place_id": "place_north_gate",
    "destination_place_id": "place_main_library",
    "profile": {"max_incline_deg": 5.0, "avoid_stairs": True}
})
dist4 = r4["actual_length_m"]
print("\n[Phase 7: Pathway Restored to Optimal Route B]")
print(f"  Distance: {dist4} m | Reason: {r4['reason_codes']}")
print(f"  Explanation: {r4['explanation']}")
assert dist4 == 650.0, f"Expected 650m restored, got {dist4}"

print("\n" + "=" * 60)
print("SUCCESS! ALL 6 SPECIFICATION DEMO PHASES VERIFIED LIVE!")
print("=" * 60)
