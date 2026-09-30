import json
import networkx as nx
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
from api.repository import repo, parse_iso
from api.schemas import MobilityProfile, RouteResponse, RouteStep
from api.spatial import haversine_m, point_to_linestring_distance_m, calculate_bearing, get_compass_direction
from api.database import get_db

class RoutingEngine:
    def __init__(self):
        self.repo = repo

    def get_current_revision(self) -> int:
        return self.repo.get_graph_state()["revision"]

    def find_nearest_node(self, lat: float, lon: float, max_dist_m: float = 1200.0) -> Tuple[Optional[str], float]:
        nodes = self.repo.get_all_nodes()
        if not nodes:
            return None, float("inf")
        best_id = None
        min_dist = float("inf")
        for n in nodes:
            d = haversine_m(lat, lon, n["lat"], n["lon"])
            if d < min_dist:
                min_dist = d
                best_id = n["id"]

        return best_id, min_dist

    def find_candidate_edges_for_pin(self, lat: float, lon: float, radius_m: float = 25.0) -> List[Dict[str, Any]]:
        edges = self.repo.get_all_edges()
        candidates = []
        for e in edges:
            coords = e["geom_parsed"]
            dist, snap = point_to_linestring_distance_m(lat, lon, coords)
            if dist <= radius_m:
                candidates.append({
                    "edge_id": e["id"],
                    "name": e["name"] or f"Path {e['from_name']} -> {e['to_name']}",
                    "distance_to_pin_m": round(dist, 1),
                    "from_node_name": e["from_name"],
                    "to_node_name": e["to_name"],
                    "stairs": bool(e["stairs"]),
                    "width_m": e["width_m"],
                    "surface": e["surface"],
                    "snap_point": [snap[0], snap[1]]
                })
        candidates.sort(key=lambda x: x["distance_to_pin_m"])
        return candidates

    def get_active_barriers_by_edge(self, strict: bool = True) -> Dict[str, List[Dict[str, Any]]]:
        """
        Query database for active reports affecting edges.
        """
        now = datetime.now(timezone.utc)
        barriers_by_edge: Dict[str, List[Dict[str, Any]]] = {}

        with get_db() as conn:
            rows = conn.execute("""
                SELECT re.edge_id, re.extent, re.direction, re.notes AS edge_notes,
                       r.id AS report_id, r.category, r.status, r.observed_at, r.notes AS report_notes
                FROM report_edges re
                JOIN reports r ON re.report_id = r.id
                WHERE r.status IN ('verified_active', 'pending', 'disputed', 'stale')
            """).fetchall()

            for r in rows:
                rep_dict = dict(r)
                obs_dt = parse_iso(rep_dict["observed_at"])
                age_h = (now - obs_dt).total_seconds() / 3600.0

                is_stale = False
                if rep_dict["category"] in ["blockage", "movable"] and age_h > 2.0:
                    is_stale = True
                elif rep_dict["category"] == "construction" and age_h > 24.0:
                    is_stale = True
                elif age_h > 720.0:
                    is_stale = True

                affects_route = False
                if rep_dict["status"] == "verified_active":
                    affects_route = True
                elif rep_dict["status"] == "pending" and strict:
                    # Strict mode excludes plausible severe reports
                    affects_route = True
                elif rep_dict["status"] == "disputed":
                    affects_route = True
                elif rep_dict["status"] == "stale":
                    if strict:
                        affects_route = True

                if affects_route:
                    eid = rep_dict["edge_id"]
                    if eid not in barriers_by_edge:
                        barriers_by_edge[eid] = []
                    barriers_by_edge[eid].append({
                        "report_id": rep_dict["report_id"],
                        "category": rep_dict["category"],
                        "status": rep_dict["status"],
                        "extent": rep_dict["extent"] or "complete",
                        "notes": rep_dict["report_notes"] or rep_dict["edge_notes"],
                        "is_stale": is_stale,
                        "age_hours": round(age_h, 1)
                    })

        return barriers_by_edge

    def calculate_route(self,
                        origin_node_id: str,
                        destination_node_id: str,
                        profile: MobilityProfile,
                        strictness: str = "strict") -> RouteResponse:
        current_rev = self.get_current_revision()
        strict = (strictness.lower() == "strict")

        all_nodes = {n["id"]: n for n in self.repo.get_all_nodes()}
        all_edges = self.repo.get_all_edges()

        if origin_node_id not in all_nodes or destination_node_id not in all_nodes:
            return RouteResponse(
                status="out_of_coverage",
                graph_revision=current_rev,
                total_distance_m=0.0,
                actual_length_m=0.0,
                edge_ids=[],
                geometry={"type": "FeatureCollection", "features": []},
                steps=[],
                evidence_coverage=0.0,
                warnings=["Selected origin or destination is outside surveyed campus network."],
                reason_codes=["OUT_OF_COVERAGE"],
                explanation="Selected place node does not exist in surveyed pedestrian network."
            )

        if origin_node_id == destination_node_id:
            node_name = all_nodes[origin_node_id]["name"]
            coords = [[all_nodes[origin_node_id]["lon"], all_nodes[origin_node_id]["lat"]], [all_nodes[origin_node_id]["lon"], all_nodes[origin_node_id]["lat"]]]
            return RouteResponse(
                status="ok",
                graph_revision=current_rev,
                total_distance_m=0.0,
                actual_length_m=0.0,
                edge_ids=[],
                geometry={
                    "type": "FeatureCollection",
                    "features": [{
                        "type": "Feature",
                        "geometry": {"type": "LineString", "coordinates": coords},
                        "properties": {"name": node_name}
                    }]
                },
                steps=[RouteStep(
                    edge_id="at_destination",
                    name=node_name,
                    instruction=f"You are at {node_name}. Destination reached.",
                    distance_m=0.0,
                    surface="paved",
                    stairs=False,
                    roughness=0.0
                )],
                evidence_coverage=1.0,
                warnings=[],
                reason_codes=["ALREADY_AT_DESTINATION"],
                explanation=f"You are at {node_name} (0 m).",
                alternatives_considered=0
            )

        barriers_by_edge = self.get_active_barriers_by_edge(strict=strict)

        G = nx.DiGraph()
        for nid, n in all_nodes.items():
            G.add_node(nid, lat=n["lat"], lon=n["lon"], name=n["name"], type=n["type"])

        excluded_edges = []
        warnings = []
        reason_codes = []

        for e in all_edges:
            # 1. Hard exclusions: Stairs
            if profile.exclude_stairs and e["stairs"]:
                excluded_edges.append({
                    "edge_id": e["id"],
                    "reason": "STAIRS_EXCLUDED",
                    "details": f"Stairs on {e['name'] or 'segment'}"
                })
                continue

            # 2. Hard exclusions: Width limit
            if profile.min_width_m is not None and e["width_m"] is not None:
                if e["width_m"] < profile.min_width_m:
                    excluded_edges.append({
                        "edge_id": e["id"],
                        "reason": "NARROW_PATH_EXCLUDED",
                        "details": f"Path width {e['width_m']}m is below required {profile.min_width_m}m"
                    })
                    continue

            # 3. Hard exclusions: Slope limit
            if profile.max_slope_pct is not None and e["slope_pct"] is not None:
                if e["slope_pct"] > profile.max_slope_pct:
                    excluded_edges.append({
                        "edge_id": e["id"],
                        "reason": "STEEP_SLOPE_EXCLUDED",
                        "details": f"Slope {e['slope_pct']}% exceeds maximum {profile.max_slope_pct}%"
                    })
                    continue

            # 4. Hard exclusions: Verified complete barrier
            edge_barriers = barriers_by_edge.get(e["id"], [])
            is_completely_blocked = any(b["extent"] == "complete" for b in edge_barriers)
            if is_completely_blocked:
                b_info = [b for b in edge_barriers if b["extent"] == "complete"][0]
                excluded_edges.append({
                    "edge_id": e["id"],
                    "reason": "BLOCKED_EDGE_AVOIDED",
                    "details": f"{b_info['category']} blocks {e['name'] or 'segment'}"
                })
                continue

            # 5. Nonnegative Cost Function (Section 7):
            # edge_cost_m = length_m + rough_penalty_m + slope_penalty_m + crossing_penalty_m + uncertainty_penalty_m
            base_len = float(e["length_m"])
            rough_penalty = 0.0
            if profile.avoid_rough and e["roughness"] and e["roughness"] > 0.05:
                rough_penalty = base_len * (e["roughness"] * 1.5)

            slope_penalty = 0.0
            if e["slope_pct"] and e["slope_pct"] > 3.0:
                slope_penalty = base_len * ((e["slope_pct"] - 3.0) / 10.0)

            crossing_penalty = 0.0
            if e["crossing_type"] == "tactile":
                crossing_penalty = 3.0
            elif e["crossing_type"] == "none":
                crossing_penalty = 12.0

            # Partial obstruction penalty
            blockage_penalty = 0.0
            if edge_barriers:
                blockage_penalty = 40.0

            uncertainty_penalty = 0.0
            if e["source"] == "unknown":
                uncertainty_penalty = 15.0

            cost = base_len + rough_penalty + slope_penalty + crossing_penalty + blockage_penalty + uncertainty_penalty

            G.add_edge(
                e["from_id"],
                e["to_id"],
                weight=cost,
                actual_length=base_len,
                edge_dict=e,
                barriers=edge_barriers
            )

        # 6. Dijkstra shortest path on constrained graph
        try:
            path_node_ids = nx.dijkstra_path(G, origin_node_id, destination_node_id, weight="weight")
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            reason_msg = "No route found meeting the selected constraints."
            reasons = ["NO_ROUTE_MEETING_CONSTRAINTS"]

            if any(x["reason"] == "BLOCKED_EDGE_AVOIDED" for x in excluded_edges):
                reasons.append("BLOCKED_EDGE_AVOIDED")
                reason_msg += " Key step-free paths are blocked by active verified barriers."
            if any(x["reason"] == "STAIRS_EXCLUDED" for x in excluded_edges):
                reasons.append("STAIRS_EXCLUDED")
                reason_msg += " Incompatible segments with stairs were strictly excluded."

            return RouteResponse(
                status="no_route",
                graph_revision=current_rev,
                total_distance_m=0.0,
                actual_length_m=0.0,
                edge_ids=[],
                geometry={"type": "FeatureCollection", "features": []},
                steps=[],
                evidence_coverage=0.0,
                warnings=["Destination is unreachable under selected mobility constraints without violating exclusions."],
                reason_codes=list(set(reasons)),
                explanation=reason_msg,
                alternatives_considered=len(excluded_edges)
            )

        # 7. Build Route Geometry, Steps, and Metrics
        route_edge_ids = []
        route_features = []
        route_steps = []
        actual_total_len = 0.0
        verified_attributes_len = 0.0
        prev_bearing = None

        for i in range(len(path_node_ids) - 1):
            u = path_node_ids[i]
            v = path_node_ids[i + 1]
            e_data = G[u][v]
            e_dict = e_data["edge_dict"]
            seg_len = float(e_data["actual_length"])

            route_edge_ids.append(e_dict["id"])
            actual_total_len += seg_len

            if e_dict["source"] == "survey" and e_dict["checked_at"]:
                verified_attributes_len += seg_len

            route_features.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": e_dict["geom_parsed"]
                },
                "properties": {
                    "edge_id": e_dict["id"],
                    "name": e_dict["name"],
                    "length_m": seg_len,
                    "stairs": bool(e_dict["stairs"]),
                    "surface": e_dict["surface"],
                    "slope_pct": e_dict["slope_pct"],
                    "width_m": e_dict["width_m"]
                }
            })

            u_name = all_nodes[u]["name"]
            v_name = all_nodes[v]["name"]

            # Compute bearing of this segment for realistic turn maneuvers
            street_title = e_dict['name'] or 'walkway'
            curr_bearing = None
            if e_dict["geom_parsed"] and len(e_dict["geom_parsed"]) >= 2:
                p_start = e_dict["geom_parsed"][0]
                p_end = e_dict["geom_parsed"][-1]
                curr_bearing = calculate_bearing(p_start[1], p_start[0], p_end[1], p_end[0])

            if prev_bearing is None or curr_bearing is None:
                cardinal = get_compass_direction(curr_bearing) if curr_bearing is not None else "forward"
                instruction = f"Head {cardinal} on {street_title} towards {v_name} ({round(seg_len)}m)"
            else:
                diff = (curr_bearing - prev_bearing + 180.0) % 360.0 - 180.0
                if diff < -45.0:
                    instruction = f"Turn left onto {street_title} towards {v_name} ({round(seg_len)}m)"
                elif diff < -15.0:
                    instruction = f"Turn slight left onto {street_title} towards {v_name} ({round(seg_len)}m)"
                elif diff > 45.0:
                    instruction = f"Turn right onto {street_title} towards {v_name} ({round(seg_len)}m)"
                elif diff > 15.0:
                    instruction = f"Turn slight right onto {street_title} towards {v_name} ({round(seg_len)}m)"
                else:
                    instruction = f"Continue straight on {street_title} towards {v_name} ({round(seg_len)}m)"

            if curr_bearing is not None:
                prev_bearing = curr_bearing
            step_warning = None
            if e_data["barriers"]:
                b_cat = e_data["barriers"][0]["category"]
                step_warning = f"Caution: partial {b_cat} reported on this segment."
                warnings.append(step_warning)
                reason_codes.append(f"PARTIAL_{b_cat.upper()}_ON_ROUTE")

            route_steps.append(RouteStep(
                edge_id=e_dict["id"],
                name=e_dict["name"] or f"{u_name} to {v_name}",
                instruction=instruction,
                distance_m=round(seg_len, 1),
                surface=e_dict["surface"] or "paved",
                stairs=bool(e_dict["stairs"]),
                slope_pct=e_dict["slope_pct"],
                width_m=e_dict["width_m"],
                roughness=e_dict["roughness"] or 0.0,
                warning=step_warning
            ))

        coverage = round((verified_attributes_len / actual_total_len), 2) if actual_total_len > 0 else 1.0

        if profile.exclude_stairs:
            reason_codes.append("STAIRS_EXCLUDED")

        # Explain why this path was chosen, especially if detours exist
        blocked_items = [x for x in excluded_edges if x["reason"] == "BLOCKED_EDGE_AVOIDED"]
        if blocked_items:
            reason_codes.append("BLOCKED_EDGE_AVOIDED")
            b_desc = blocked_items[0]["details"]
            explanation = f"Route changed because {b_desc}. The alternative is {round(actual_total_len)} m, avoiding all blocked segments."
        else:
            explanation = f"Recommended step-free route ({round(actual_total_len)} m). All known barriers and stairs avoided."

        return RouteResponse(
            status="ok",
            graph_revision=current_rev,
            total_distance_m=round(actual_total_len, 1),
            actual_length_m=round(actual_total_len, 1),
            edge_ids=route_edge_ids,
            geometry={
                "type": "FeatureCollection",
                "features": route_features
            },
            steps=route_steps,
            evidence_coverage=coverage,
            warnings=list(set(warnings)),
            reason_codes=list(set(reason_codes)),
            explanation=explanation,
            alternatives_considered=len(excluded_edges)
        )

routing_engine = RoutingEngine()
