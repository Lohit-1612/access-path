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
