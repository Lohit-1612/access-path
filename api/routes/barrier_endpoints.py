from typing import Optional, List
from fastapi import APIRouter, Query
from api.repository import repo
from api.schemas import BarrierItem
from data.seed_data import seed_database

router = APIRouter(tags=["barriers_and_graph"])

@router.get("/barriers", response_model=List[BarrierItem])
def get_barriers(
    status: Optional[str] = Query(None, description="Filter by status: verified_active, pending, disputed, stale, resolved, rejected"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0)
):
    """
    Get public barrier items with freshness and staleness details.
    """
    barriers = repo.list_barriers(status_filter=status, limit=limit, offset=offset)
    return barriers

from pydantic import BaseModel
from fastapi import HTTPException

class MarkBarrierRequest(BaseModel):
    category: str = "blockage"
    lat: float
    lon: float
    notes: Optional[str] = None
    reporter_name: Optional[str] = "User"
    affected_edge_ids: Optional[List[str]] = None
    extent: Optional[str] = "complete"

@router.post("/barriers/mark")
def mark_barrier(req: MarkBarrierRequest):
    """
    Directly mark and activate an accessibility barrier.
    All users will immediately see it on the map and their routes will avoid it.
    """
    result = repo.mark_active_barrier(
        category=req.category,
        lat=req.lat,
        lon=req.lon,
        notes=req.notes,
        reporter_name=req.reporter_name or "User",
        affected_edge_ids=req.affected_edge_ids,
        extent=req.extent or "complete"
    )
    return result

@router.delete("/barriers/{barrier_id}")
def delete_barrier(barrier_id: str, reason: Optional[str] = "Cleared by user"):
    """
    Delete or clear an active barrier, immediately restoring the pathway for all users.
    """
    try:
        result = repo.delete_barrier(report_id=barrier_id, reason=reason or "Cleared by user")
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.post("/barriers/{barrier_id}/delete")
def delete_barrier_post(barrier_id: str, reason: Optional[str] = "Cleared by user"):
    """
    POST alias for barrier deletion to support all HTTP environments.
    """
    try:
        result = repo.delete_barrier(report_id=barrier_id, reason=reason or "Cleared by user")
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.get("/places")
def get_places():
    return repo.get_all_places()

@router.get("/nodes")
def get_nodes():
    return repo.get_all_nodes()

@router.get("/edges")
def get_edges():
    return repo.get_all_edges()

@router.get("/graph/state")
def get_graph_state():
    return repo.get_graph_state()

class RelocateRequest(BaseModel):
    lat: float
    lon: float

@router.post("/demo/reset")
def reset_demo_data():
    """
    Reset all database records, graphs, and barriers back to the pristine calibrated demo state.
    """
    seed_database()
    return {"status": "ok", "message": "Demo database successfully reset to pristine calibrated state."}

import urllib.request
import json

@router.post("/graph/relocate")
def relocate_campus(req: RelocateRequest):
    """
    Center the accessible campus pedestrian network directly around the user's real-time GPS position,
    positioning the entrance directly at the user's location with the actual street name.
    """
    origin_name = f"Location ({req.lat:.4f}, {req.lon:.4f})"
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?lat={req.lat}&lon={req.lon}&format=json&addressdetails=1"
        r = urllib.request.Request(url, headers={"User-Agent": "AccessPath-App/1.0"})
        with urllib.request.urlopen(r, timeout=2.5) as resp:
            data = json.loads(resp.read().decode())
            addr = data.get("address", {})
            road = addr.get("road") or addr.get("pedestrian") or data.get("name")
            area = addr.get("neighbourhood") or addr.get("suburb") or addr.get("city")
            if road and area:
                origin_name = f"{road}, {area}"
            elif road:
                origin_name = road
    except Exception:
        pass

    calculated_base_lat = req.lat - (480.0 / 111139.0)
    seed_database(base_lat=calculated_base_lat, base_lon=req.lon, origin_street_name=origin_name)
    new_rev = repo.increment_graph_revision(
        affected_edge_ids=[],
        event_type="graph_relocated",
        payload={"base_lat": req.lat, "base_lon": req.lon, "origin_name": origin_name}
    )
    return {
        "status": "ok",
        "message": f"Pedestrian network successfully relocated to {origin_name}",
        "origin_name": origin_name,
        "graph_revision": new_rev,
        "base_lat": req.lat,
        "base_lon": req.lon
    }
