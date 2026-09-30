export interface MobilityProfile {
  name: 'wheelchair' | 'limited_mobility' | 'low_vision' | 'pedestrian' | 'custom';
  exclude_stairs: boolean;
  max_slope_pct?: number;
  min_width_m?: number;
  avoid_rough: boolean;
  avoid_construction: boolean;
  step_free_required: boolean;
}

export interface Place {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  entrance_node_ids: string[];
}

export interface NodeItem {
  id: string;
  name: string;
  type: string;
  lat: number;
  lon: number;
  level: number;
}

export interface EdgeItem {
  id: string;
  name: string;
  from_id: string;
  to_id: string;
  from_name: string;
  to_name: string;
  geom_parsed: [number, number][]; // [lon, lat]
  length_m: number;
  stairs: boolean;
  width_m?: number;
  slope_pct?: number;
  roughness: number;
  crossing_type?: string;
  surface: string;
}

export interface RouteStep {
  edge_id: string;
  name: string;
  instruction: string;
  distance_m: number;
  surface: string;
  stairs: boolean;
  slope_pct?: number;
  width_m?: number;
  roughness: number;
  warning?: string;
  source?: string;
  checked_at?: string;
  is_verified?: boolean;
}

export interface RouteResponse {
  status: 'ok' | 'no_route' | 'out_of_coverage';
  graph_revision: number;
  total_distance_m: number;
  actual_length_m: number;
  edge_ids: string[];
  geometry: {
    type: string;
    features: Array<{
      type: string;
      geometry: {
        type: string;
        coordinates: [number, number][];
      };
      properties: Record<string, any>;
    }>;
  };
  steps: RouteStep[];
  evidence_coverage: number;
  evidence_breakdown?: {
    verified_length_m: number;
    total_length_m: number;
    verified_segments: number;
    total_segments: number;
    surveyed_coverage_pct: number;
    data_sources: string[];
  };
  turn_count?: number;
  warnings: string[];
  reason_codes: string[];
  explanation?: string;
  alternatives_considered?: number;
}

export interface Detection {
  id: string;
  box_x1: number;
  box_y1: number;
  box_x2: number;
  box_y2: number;
  label: string;
  raw_score: number;
  model_revision: string;
  prompt: string;
  is_precomputed: boolean;
}

export interface CandidateEdge {
  edge_id: string;
  name: string;
  distance_to_pin_m: number;
  from_node_name: string;
  to_node_name: string;
  stairs: boolean;
  width_m?: number;
  surface: string;
  snap_point?: [number, number];
}

export interface ReportDetail {
  id: string;
  category: string;
  status: 'draft' | 'pending' | 'verified_active' | 'disputed' | 'stale' | 'resolved' | 'rejected';
  lat: number;
  lon: number;
  accuracy_m: number;
  observed_at: string;
  version: number;
  notes?: string;
  image_url?: string;
  detections: Detection[];
  affected_edges: string[];
  candidate_edges: CandidateEdge[];
  reviews: Array<{
    id: string;
    actor_name: string;
    action: string;
    reason: string;
    old_state: string;
    new_state: string;
    timestamp: string;
  }>;
}

export interface BarrierItem {
  id: string;
  category: string;
  status: string;
  lat: number;
  lon: number;
  accuracy_m: number;
  observed_at: string;
  affected_edge_ids: string[];
  image_url?: string;
  notes?: string;
  is_stale: boolean;
  freshness_hours: number;
}

export interface RevisionEvent {
  id: string;
  revision: number;
  event_type: string;
  payload: Record<string, any>;
  created_at: string;
}
