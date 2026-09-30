import pytest
from api.routing import routing_engine
from api.schemas import MobilityProfile
from api.repository import repo
from data.seed_data import seed_database

@pytest.fixture(autouse=True)
def reset_db():
    seed_database()
    yield
    seed_database()

def test_hard_constraints_exclude_stairs():
    """All wheelchair fixtures must strictly exclude stairs."""
    profile = MobilityProfile(name="wheelchair", exclude_stairs=True, max_slope_pct=8.0)
    route = routing_engine.calculate_route("n_gate", "n_lib_entrance", profile)
    
    assert route.status == "ok"
    assert "STAIRS_EXCLUDED" in route.reason_codes
    # Verify no edge in the route has stairs
    edges = {e["id"]: e for e in repo.get_all_edges()}
    for eid in route.edge_ids:
        assert not edges[eid]["stairs"], f"Edge {eid} has stairs but was included in wheelchair route!"

def test_pedestrian_profile_selects_shorter_stairs_route():
    """Pedestrian profile without stair constraints selects the direct 500m Route A."""
    profile = MobilityProfile(name="pedestrian", exclude_stairs=False, avoid_rough=False, max_slope_pct=100.0)
    route = routing_engine.calculate_route("n_gate", "n_lib_entrance", profile)
    
    assert route.status == "ok"
    assert route.total_distance_m == 500.0
    # Great hall stairs are included
    assert "e_stairs_fwd" in route.edge_ids

def test_wheelchair_selects_650m_step_free_route_b_initially():
    """Initial wheelchair route selects East Footpath (Route B: 650m)."""
    profile = MobilityProfile(name="wheelchair", exclude_stairs=True, max_slope_pct=8.0)
    route = routing_engine.calculate_route("n_gate", "n_lib_entrance", profile)
    
    assert route.status == "ok"
    assert route.total_distance_m == 650.0
    assert "e_east_blocked_segment_fwd" in route.edge_ids

def test_dynamic_update_reroutes_to_720m_when_b_blocked():
    """When East Footpath is blocked and verified, route dynamically diverts to Route C (720m, +70m)."""
    # 1. Reporter submits report
    rep_id = repo.create_draft_report("construction", 13.08388, 80.27173, notes="East walkway excavation")
    repo.patch_report_and_submit(
        rep_id, "construction",
        ["e_east_blocked_segment_fwd", "e_east_blocked_segment_rev"],
        extent="complete", direction="both", notes="Excavator blocking passage",
        expected_version=1
    )
    # 2. Verifier approves report
    rev = repo.add_review(rep_id, "verify", "Confirmed active construction work", expected_version=2)
    assert rev["new_state"] == "verified_active"
    assert rev["graph_revision"] == 2

    # 3. Wheelchair route calculation after verification
    profile = MobilityProfile(name="wheelchair", exclude_stairs=True, max_slope_pct=8.0)
    route = routing_engine.calculate_route("n_gate", "n_lib_entrance", profile)
    
    assert route.status == "ok"
    assert route.total_distance_m == 720.0
    assert "BLOCKED_EDGE_AVOIDED" in route.reason_codes
    assert "East Footpath Tree Walkway" in route.explanation
    assert "e_east_blocked_segment_fwd" not in route.edge_ids
    assert "e_ramptop_mid_fwd" in route.edge_ids  # Uses West Ramp corridor

def test_verified_clearance_restores_route():
    """When verifier resolves the barrier, route eligibility is restored to 650m."""
    # Create and verify barrier
    rep_id = repo.create_draft_report("construction", 13.08388, 80.27173)
    repo.patch_report_and_submit(rep_id, "construction", ["e_east_blocked_segment_fwd", "e_east_blocked_segment_rev"], "complete", "both", None, 1)
    repo.add_review(rep_id, "verify", "Confirmed", 2)
    
    # Now verifier marks it resolved
    rev = repo.add_review(rep_id, "resolve", "Construction concluded; debris removed", 3)
    assert rev["new_state"] == "resolved"
    assert rev["graph_revision"] == 3

    # Route recalculation
    profile = MobilityProfile(name="wheelchair", exclude_stairs=True, max_slope_pct=8.0)
    route = routing_engine.calculate_route("n_gate", "n_lib_entrance", profile)
    assert route.status == "ok"
    assert route.total_distance_m == 650.0

def test_disconnected_destination_returns_honest_no_route():
    """An unreachable isolated pavilion must return status=no_route with explanation, not fabricate straight lines."""
    profile = MobilityProfile(name="wheelchair", exclude_stairs=True)
    route = routing_engine.calculate_route("n_gate", "n_disconnected_pavilion", profile)
    
    assert route.status == "no_route"
    assert "NO_ROUTE_MEETING_CONSTRAINTS" in route.reason_codes
    assert len(route.edge_ids) == 0

def test_both_routes_blocked_does_not_quietly_reintroduce_stairs():
    """If both step-free alternatives (B and C) are blocked, system returns no_route rather than falling back to stairs."""
    # Block Route B
    r1 = repo.create_draft_report("construction", 13.08388, 80.27173)
    repo.patch_report_and_submit(r1, "construction", ["e_east_blocked_segment_fwd", "e_east_blocked_segment_rev"], "complete", "both", None, 1)
    repo.add_review(r1, "verify", "B blocked", 2)

    # Block Route C
    r2 = repo.create_draft_report("construction", 13.08412, 80.26938)
    repo.patch_report_and_submit(r2, "construction", ["e_ramptop_mid_fwd", "e_ramptop_mid_rev"], "complete", "both", None, 1)
    repo.add_review(r2, "verify", "C blocked", 2)

    profile = MobilityProfile(name="wheelchair", exclude_stairs=True)
    route = routing_engine.calculate_route("n_gate", "n_lib_entrance", profile)

    assert route.status == "no_route"
    assert "STAIRS_EXCLUDED" in route.reason_codes
    assert "BLOCKED_EDGE_AVOIDED" in route.reason_codes

def test_full_hackathon_demo_flow():
    """
    Complete hackathon demonstration flow:
    Detect barrier -> submit report -> verify information -> update affected routes -> communicate changes -> resolve barrier.
    """
    profile = MobilityProfile(name="wheelchair", exclude_stairs=True, max_slope_pct=8.0)

    # 1. Initial State: Route B is optimal step-free path (650m)
    r_initial = routing_engine.calculate_route("n_gate", "n_lib_entrance", profile)
    assert r_initial.status == "ok"
    assert r_initial.total_distance_m == 650.0
    assert r_initial.evidence_coverage > 0.0
    assert r_initial.turn_count >= 1
    assert r_initial.evidence_breakdown["verified_segments"] > 0

    # 2. Citizen detects barrier & submits report -> enters 'pending'
    rep_id = repo.create_draft_report("construction", 13.08388, 80.27173, notes="Excavator digging trench across East walkway")
    patched = repo.patch_report_and_submit(
        rep_id, "construction",
        ["e_east_blocked_segment_fwd", "e_east_blocked_segment_rev"],
        extent="complete", direction="both",
        notes="Pathway completely impassable for wheelchairs",
        expected_version=1
    )
    assert patched["status"] == "pending"

    # 3. Verifier reviews information in queue & verifies it
    rev = repo.add_review(
        rep_id, "verify",
        reason="Field inspection confirmed deep trench across East Footpath Tree Walkway",
        expected_version=2,
        actor_name="Dr. Sarah Miller (Campus Verifier)"
    )
    assert rev["new_state"] == "verified_active"
    assert rev["graph_revision"] >= 2

    # 4. Route recalculates dynamically to Route C (720m, +70m detour)
    r_detour = routing_engine.calculate_route("n_gate", "n_lib_entrance", profile)
    assert r_detour.status == "ok"
    assert r_detour.total_distance_m == 720.0
    assert "BLOCKED_EDGE_AVOIDED" in r_detour.reason_codes
    assert "East Footpath Tree Walkway" in r_detour.explanation
    assert "720 m" in r_detour.explanation
    assert "e_east_blocked_segment_fwd" not in r_detour.edge_ids

    # 5. Citizen reports barrier cleared
    clear_info = repo.report_barrier_cleared(rep_id, reporter_name="Citizen User", notes="Trench filled and paved")
    assert clear_info["status"] == "ok"

    # 6. Verifier inspects and confirms resolution -> status 'resolved'
    res_rev = repo.add_review(
        rep_id, "resolve",
        reason="Facilities completed repaving; pathway fully certified accessible",
        expected_version=4,  # version was bumped by clearance report
        actor_name="Dr. Sarah Miller (Campus Verifier)"
    )
    assert res_rev["new_state"] == "resolved"

    # 7. Route automatically restores to Route B (650m)
    r_restored = routing_engine.calculate_route("n_gate", "n_lib_entrance", profile)
    assert r_restored.status == "ok"
    assert r_restored.total_distance_m == 650.0
    assert "BLOCKED_EDGE_AVOIDED" not in r_restored.reason_codes

