from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

# Mobility Profile Settings
class MobilityProfile(BaseModel):
    name: str = "wheelchair"  # wheelchair, limited_mobility, low_vision, custom
    exclude_stairs: bool = True
    max_slope_pct: Optional[float] = 8.0  # e.g. 8% max slope for wheelchairs
    min_width_m: Optional[float] = 0.9    # 0.9m minimum width
    avoid_rough: bool = True
    avoid_construction: bool = True
    step_free_required: bool = True

class RouteRequest(BaseModel):
    origin_place_id: Optional[str] = None
    destination_place_id: Optional[str] = None
    origin_point: Optional[List[float]] = None  # [lat, lon]
    destination_point: Optional[List[float]] = None  # [lat, lon]
    profile: MobilityProfile = Field(default_factory=MobilityProfile)
    strictness: str = "strict"  # strict (exclude unknown/unverified high-severity), exploratory

class RouteStep(BaseModel):
    edge_id: str
    name: str
    instruction: str
    distance_m: float
    surface: str
    stairs: bool
    slope_pct: Optional[float] = None
    width_m: Optional[float] = None
    roughness: float
    warning: Optional[str] = None
    source: Optional[str] = "survey"
    checked_at: Optional[str] = None
    is_verified: bool = True

class RouteResponse(BaseModel):
    status: str  # ok, no_route, out_of_coverage
    graph_revision: int
    total_distance_m: float
    actual_length_m: float
    edge_ids: List[str]
    geometry: Dict[str, Any]  # GeoJSON Feature or FeatureCollection
    steps: List[RouteStep]
    evidence_coverage: float  # proportion 0.0 - 1.0 of route attributes checked and current
    evidence_breakdown: Optional[Dict[str, Any]] = None
    turn_count: Optional[int] = 0
    warnings: List[str]
    reason_codes: List[str]
    explanation: Optional[str] = None
    alternatives_considered: Optional[int] = 0

class ReportCreate(BaseModel):
    category: str
    lat: float
    lon: float
    accuracy_m: float = 5.0
    observed_time: Optional[datetime] = None
    notes: Optional[str] = None

class ReportPatch(BaseModel):
    corrected_category: Optional[str] = None
    affected_edge_ids: List[str] = []
    extent: str = "complete"  # complete, partial
    direction: str = "both"
    notes: Optional[str] = None
    expected_version: int

class ReviewCreate(BaseModel):
    action: str  # verify, dispute, reject, resolve
    reason: str
    expected_version: int
    actor_name: Optional[str] = "Campus Verifier"

class ReviewResponse(BaseModel):
    report_id: str
    old_state: str
    new_state: str
    audit_id: str
    graph_revision: int
    reason: str
    timestamp: datetime

class CandidateEdge(BaseModel):
    edge_id: str
    name: str
    distance_to_pin_m: float
    from_node_name: str
    to_node_name: str
    stairs: bool
    width_m: Optional[float]
    surface: str

class DetectionSchema(BaseModel):
    id: str
    box_x1: float
    box_y1: float
    box_x2: float
    box_y2: float
    label: str
    raw_score: float
    model_revision: str
    prompt: str
    is_precomputed: bool

class JobResponse(BaseModel):
    id: str
    state: str  # queued, running, succeeded, failed
    attempts: int
    error: Optional[str] = None
    detections: List[DetectionSchema] = []

class ReportDetail(BaseModel):
    id: str
    category: str
    status: str
    lat: float
    lon: float
    accuracy_m: float
    observed_at: datetime
    version: int
    notes: Optional[str]
    image_url: Optional[str] = None
    detections: List[DetectionSchema] = []
    affected_edges: List[str] = []
    candidate_edges: List[CandidateEdge] = []
    reviews: List[Dict[str, Any]] = []
    created_at: datetime
    updated_at: datetime

class BarrierItem(BaseModel):
    id: str
    category: str
    status: str
    lat: float
    lon: float
    accuracy_m: float
    observed_at: datetime
    affected_edge_ids: List[str]
    image_url: Optional[str] = None
    notes: Optional[str] = None
    is_stale: bool = False
    freshness_hours: float

class EventItem(BaseModel):
    id: str
    revision: int
    event_type: str
    payload: Dict[str, Any]
    created_at: datetime

class MarkBarrierRequest(BaseModel):
    category: str = "blockage"
    lat: float
    lon: float
    notes: Optional[str] = None
    reporter_name: Optional[str] = "User"
    affected_edge_ids: Optional[List[str]] = None
    extent: Optional[str] = "complete"
    role: Optional[str] = "reporter"  # "reporter" -> pending, "verifier" -> verified_active

class ReportClearedRequest(BaseModel):
    reporter_name: Optional[str] = "User"
    notes: Optional[str] = "Cleared / path restored"
    role: Optional[str] = "reporter"  # "verifier" resolves directly, "reporter" flags pending clearance
