import pytest
from fastapi.testclient import TestClient
from api.main import app
from data.seed_data import seed_database

client = TestClient(app)

@pytest.fixture(autouse=True)
def run_around_tests():
    seed_database()
    yield
    seed_database()

def test_health_check():
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert data["api"] == "ready"
    assert data["database"] == "connected"
    assert "inference" in data

def test_get_places_and_nodes():
    res_places = client.get("/api/places")
    assert res_places.status_code == 200
    places = res_places.json()
    assert len(places) >= 5

    res_nodes = client.get("/api/nodes")
    assert res_nodes.status_code == 200
    nodes = res_nodes.json()
    assert len(nodes) >= 25

def test_report_lifecycle_and_optimistic_concurrency():
    # 1. Submit report with sample image key -> 202
    res = client.post("/api/reports", data={
        "category": "construction",
        "lat": 13.08388,
        "lon": 80.27173,
        "notes": "Barricade on east path",
        "sample_key": "construction_east_path.jpg"
    })
    assert res.status_code == 202
    data = res.json()
    report_id = data["report_id"]
    job_id = data["job_id"]
    assert data["status"] == "draft"

    # 2. Check job status
    job_res = client.get(f"/api/jobs/{job_id}")
    assert job_res.status_code == 200
    job_data = job_res.json()
    assert job_data["state"] in ["succeeded", "queued", "running"]
    assert len(job_data["detections"]) > 0
    assert job_data["detections"][0]["label"] == "construction"

    # 3. Fetch report details with candidate edges
    rep_res = client.get(f"/api/reports/{report_id}")
    assert rep_res.status_code == 200
    rep_data = rep_res.json()
    assert len(rep_data["candidate_edges"]) > 0
    assert rep_data["version"] == 1

    # 4. Patch report (Reporter confirmation)
    patch_res = client.patch(f"/api/reports/{report_id}", json={
        "corrected_category": "construction",
        "affected_edge_ids": ["e_east_blocked_segment_fwd", "e_east_blocked_segment_rev"],
        "extent": "complete",
        "direction": "both",
        "notes": "Verified by reporter on scene",
        "expected_version": 1
    })
    assert patch_res.status_code == 200
    assert patch_res.json()["status"] == "pending"
    assert patch_res.json()["version"] == 2

    # 5. Test optimistic concurrency conflict (409) if version mismatch
    conflict_res = client.patch(f"/api/reports/{report_id}", json={
        "corrected_category": "construction",
        "affected_edge_ids": ["e_east_blocked_segment_fwd"],
        "extent": "complete",
        "direction": "both",
        "expected_version": 1  # stale version!
    })
    assert conflict_res.status_code == 409

    # 6. Verifier approves report (Review stage)
    rev_res = client.post(f"/api/reports/{report_id}/reviews", json={
        "action": "verify",
        "reason": "Confirmed active construction",
        "expected_version": 2,
        "actor_name": "Dr. Sarah Miller"
    })
    assert rev_res.status_code == 200
    rev_data = rev_res.json()
    assert rev_data["new_state"] == "verified_active"
    assert rev_data["graph_revision"] == 2

def test_api_route_calculation():
    payload = {
        "origin_place_id": "place_north_gate",
        "destination_place_id": "place_main_library",
        "profile": {
            "name": "wheelchair",
            "exclude_stairs": True,
            "max_slope_pct": 8.0
        },
        "strictness": "strict"
    }
    res = client.post("/api/routes", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["total_distance_m"] == 650.0
    assert len(data["steps"]) > 0
    assert data["evidence_coverage"] > 0.0

def test_api_barriers_freshness_filter():
    res = client.get("/api/barriers")
    assert res.status_code == 200
    barriers = res.json()
    assert len(barriers) > 0
    for b in barriers:
        assert "freshness_hours" in b
        assert "is_stale" in b

def test_api_vision_detect_obstacle():
    # Test multilingual obstacle detection for blind navigation
    res = client.post("/api/vision/detect-obstacle", json={
        "hint_category": "construction",
        "language": "ta"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["detected"] is True
    assert len(data["obstacles"]) > 0
    first_obs = data["obstacles"][0]
    assert first_obs["label"] == "construction"
    assert "எச்சரிக்கை" in first_obs["warning"]

def test_api_mark_and_delete_barrier():
    # 1. Citizen marks a barrier -> enters 'pending' (unverified)
    user_mark_res = client.post("/api/barriers/mark", json={
        "category": "construction",
        "lat": 13.08388,
        "lon": 80.27173,
        "notes": "Emergency construction work reported by citizen",
        "role": "reporter"
    })
    assert user_mark_res.status_code == 200
    user_mark_data = user_mark_res.json()
    assert user_mark_data["status"] == "ok"
    assert user_mark_data["barrier_status"] == "pending"
    pending_id = user_mark_data["report_id"]

    # Verify barrier appears in pending queue
    pending_res = client.get("/api/barriers?status=pending")
    assert pending_res.status_code == 200
    pending_ids = [b["id"] for b in pending_res.json()]
    assert pending_id in pending_ids

    # Citizen reports clearance
    clear_res = client.post(f"/api/barriers/{pending_id}/report-cleared", json={
        "reporter_name": "Citizen User",
        "notes": "Barricade removed",
        "role": "reporter"
    })
    assert clear_res.status_code == 200

    # 2. Verifier marks barrier directly -> enters 'verified_active'
    verifier_mark_res = client.post("/api/barriers/mark", json={
        "category": "blockage",
        "lat": 13.08388,
        "lon": 80.27173,
        "notes": "Verified tree blockage",
        "role": "verifier"
    })
    assert verifier_mark_res.status_code == 200
    verifier_mark_data = verifier_mark_res.json()
    assert verifier_mark_data["status"] == "ok"
    assert verifier_mark_data["barrier_status"] == "verified_active"
    verified_id = verifier_mark_data["report_id"]

    # Verify appears in verified_active
    active_res = client.get("/api/barriers?status=verified_active")
    assert active_res.status_code == 200
    active_ids = [b["id"] for b in active_res.json()]
    assert verified_id in active_ids

    # 3. Verifier resolves / deletes the barrier
    del_res = client.delete(f"/api/barriers/{verified_id}", params={"reason": "Cleared by campus facilities"})
    assert del_res.status_code == 200
    del_data = del_res.json()
    assert del_data["status"] == "ok"

    # Verify barrier is resolved and no longer in active barriers
    active_res2 = client.get("/api/barriers?status=verified_active")
    active_ids2 = [b["id"] for b in active_res2.json()]
    assert verified_id not in active_ids2
