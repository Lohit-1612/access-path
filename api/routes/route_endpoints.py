from fastapi import APIRouter, HTTPException, Query
from api.schemas import RouteRequest, RouteResponse, RouteStep
from api.routing import routing_engine
from api.repository import repo
from api.spatial import haversine_m
from typing import Optional, List, Dict, Any, Tuple
import urllib.request
import urllib.parse
import json

router = APIRouter(tags=["routing"])

def resolve_text_destination(text: str, places: Dict[str, Any], all_nodes: List[Dict[str, Any]]) -> Tuple[Optional[str], Optional[List[float]], str]:
    """
    Resolve a typed text destination by checking:
    1. Direct place name match
    2. Direct node name match
    3. Campus synonym keywords (library, cafe, science, sports, quad, gate, etc.)
    4. Free OpenStreetMap Nominatim geocoding
    Returns (node_id, point_coords [lat, lon], display_name)
    """
    clean = text.strip().lower()

    # 1. Match place name
    for pid, p in places.items():
        if clean in p["name"].lower() or p["name"].lower() in clean:
            if p["entrance_node_ids"]:
                return p["entrance_node_ids"][0], [p["lat"], p["lon"]], p["name"]

    # 2. Match node name
    for n in all_nodes:
        if clean in n["name"].lower() or n["name"].lower() in clean:
            return n["id"], [n["lat"], n["lon"]], n["name"]

    # 3. Known campus keywords mapping
    keyword_map = {
        "library": ("place_main_library", "Main Library"),
        "book": ("place_main_library", "Main Library"),
        "study": ("place_main_library", "Main Library"),
        "science": ("place_science_centre", "Science & Tech Complex"),
        "lab": ("place_science_centre", "Science & Tech Complex"),
        "tech": ("place_science_centre", "Science & Tech Complex"),
        "cafe": ("place_student_cafe", "Student Hub & Cafe"),
        "coffee": ("place_student_cafe", "Student Hub & Cafe"),
        "food": ("place_student_cafe", "Student Hub & Cafe"),
        "dining": ("place_student_cafe", "Student Hub & Cafe"),
        "canteen": ("place_student_cafe", "Student Hub & Cafe"),
        "gate": ("place_north_gate", "North Main Gate"),
        "entrance": ("place_north_gate", "North Main Gate"),
        "north": ("place_north_gate", "North Main Gate"),
        "sports": ("n_sports_oval", "Sports Oval Gate"),
        "gym": ("n_sports_oval", "Sports Oval Gate"),
        "oval": ("n_sports_oval", "Sports Oval Gate"),
        "engineering": ("n_eng_hall", "Engineering Hall"),
        "hall": ("n_eng_hall", "Engineering Hall"),
        "quad": ("n_quad_center", "Central Quad Plaza"),
        "plaza": ("n_quad_center", "Central Quad Plaza"),
        "ramp": ("c_west_ramp_mid", "Innovation Ramp")
    }
    for kw, (target_id, target_name) in keyword_map.items():
        if kw in clean:
            if target_id in places and places[target_id]["entrance_node_ids"]:
                p = places[target_id]
                return p["entrance_node_ids"][0], [p["lat"], p["lon"]], target_name
            elif any(n["id"] == target_id for n in all_nodes):
                n = next(n for n in all_nodes if n["id"] == target_id)
                return target_id, [n["lat"], n["lon"]], target_name

    # 4. Geocode using Photon (high-speed) or OpenStreetMap Nominatim
    try:
        q_encoded = urllib.parse.quote(text.strip())
        photon_url = f"https://photon.komoot.io/api/?q={q_encoded}&limit=1"
        req = urllib.request.Request(photon_url, headers={"User-Agent": "AccessPath-App/1.0"})
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            pdata = json.loads(resp.read().decode())
            features = pdata.get("features", [])
            if features:
                coords = features[0]["geometry"]["coordinates"]
                glon, glat = float(coords[0]), float(coords[1])
                props = features[0].get("properties", {})
                dname = props.get("name") or text.strip()
                nearest_id, _ = routing_engine.find_nearest_node(glat, glon)
                return nearest_id, [glat, glon], dname
    except Exception:
        pass

    try:
        q_encoded = urllib.parse.quote(text.strip())
        url = f"https://nominatim.openstreetmap.org/search?q={q_encoded}&format=json&limit=1"
        req = urllib.request.Request(url, headers={"User-Agent": "AccessPath-App/1.0"})
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            data = json.loads(resp.read().decode())
            if data and len(data) > 0:
                glat = float(data[0]["lat"])
                glon = float(data[0]["lon"])
                nearest_id, _ = routing_engine.find_nearest_node(glat, glon)
                return nearest_id, [glat, glon], data[0].get("display_name", text)
    except Exception:
        pass

    # 5. Default fallback to Main Library
    if "place_main_library" in places and places["place_main_library"]["entrance_node_ids"]:
        p = places["place_main_library"]
        return p["entrance_node_ids"][0], [p["lat"], p["lon"]], p["name"]

    first_node = all_nodes[0] if all_nodes else None
    if first_node:
        return first_node["id"], [first_node["lat"], first_node["lon"]], first_node["name"]
    return None, None, text

@router.get("/places/reverse")
def reverse_geocode(lat: float = Query(...), lon: float = Query(...)):
    """
    Reverse geocode real-time GPS coordinates using OpenStreetMap Nominatim
    to extract the actual road / street name and neighborhood (e.g. Raja Muthiah Road, Periamet).
    """
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json&addressdetails=1"
        req = urllib.request.Request(url, headers={"User-Agent": "AccessPath-App/1.0"})
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            data = json.loads(resp.read().decode())
            addr = data.get("address", {})
            road = addr.get("road") or addr.get("pedestrian") or addr.get("path") or data.get("name") or "Current Location"
            area = addr.get("neighbourhood") or addr.get("suburb") or addr.get("city_district") or addr.get("city") or ""
            display = f"{road}, {area}" if area else road
            return {
                "status": "ok",
                "street_name": road,
                "area": area,
                "display_name": display,
                "full_address": data.get("display_name", display),
                "lat": lat,
                "lon": lon
            }
    except Exception:
        return {
            "status": "fallback",
            "street_name": "Current Location",
            "area": "",
            "display_name": f"Location ({lat:.4f}, {lon:.4f})",
            "full_address": f"Location ({lat:.4f}, {lon:.4f})",
            "lat": lat,
            "lon": lon
        }

@router.get("/places/search")
def search_destinations(
    q: str = Query(..., min_length=1),
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None)
):
    """
    Live autocomplete search for destinations and street names like Google Maps.
    Uses Photon (high-speed OpenStreetMap) with Nominatim fallback.
    Returns matching streets, places, and areas with haversine distance from the user.
    """
    clean = q.strip().lower()
    results = []
    seen_names = set()

    # 1. Query Photon (blazing fast, no rate-limiting, geo-biased)
    if len(clean) >= 2:
        try:
            q_enc = urllib.parse.quote(q.strip())
            photon_url = f"https://photon.komoot.io/api/?q={q_enc}&limit=8"
            if lat is not None and lon is not None:
                photon_url += f"&lat={lat}&lon={lon}"
            req = urllib.request.Request(photon_url, headers={"User-Agent": "AccessPath-App/1.0"})
            with urllib.request.urlopen(req, timeout=3.5) as resp:
                data = json.loads(resp.read().decode())
                features = data.get("features", [])
                for f in features:
                    props = f.get("properties", {})
                    coords = f.get("geometry", {}).get("coordinates", [])
                    if len(coords) >= 2:
                        ilon, ilat = float(coords[0]), float(coords[1])
                        name = props.get("name") or props.get("street") or q.strip()
                        parts = [
                            props.get("street"),
                            props.get("locality"),
                            props.get("district"),
                            props.get("city") or props.get("county"),
                            props.get("state"),
                            props.get("postcode")
                        ]
                        subtitle = ", ".join([p for p in parts if p and p != name]) or props.get("country", "")
                        area = props.get("district") or props.get("locality") or props.get("county") or ""
                        category = props.get("osm_value") or props.get("type") or "locality"

                        dist_m = haversine_m(lat, lon, ilat, ilon) if (lat is not None and lon is not None) else None
                        dist_str = f"{round(dist_m)} m" if (dist_m is not None and dist_m < 1000) else (f"{dist_m/1000.0:.1f} km" if dist_m is not None else None)

                        item_key = f"{name.lower()}_{round(ilat, 3)}_{round(ilon, 3)}"
                        if item_key not in seen_names:
                            seen_names.add(item_key)
                            results.append({
                                "id": f"photon_{props.get('osm_id', id(f))}",
                                "name": name,
                                "subtitle": subtitle or name,
                                "area": area,
                                "category": category,
                                "lat": ilat,
                                "lon": ilon,
                                "distance_m": round(dist_m) if dist_m is not None else None,
                                "distance_str": dist_str,
                                "type": "street_address"
                            })
        except Exception:
            pass

    # 2. Fallback to OpenStreetMap Nominatim if needed
    if len(clean) >= 2 and len(results) < 3:
        try:
            q_enc = urllib.parse.quote(q.strip())
            url = f"https://nominatim.openstreetmap.org/search?q={q_enc}&format=json&limit=6&addressdetails=1"
            req = urllib.request.Request(url, headers={"User-Agent": "AccessPath-App/1.0"})
            with urllib.request.urlopen(req, timeout=3.5) as resp:
                data = json.loads(resp.read().decode())
                for item in data:
                    ilat = float(item["lat"])
                    ilon = float(item["lon"])
                    addr = item.get("address", {})
                    road = addr.get("road") or addr.get("pedestrian") or addr.get("amenity") or item.get("name") or item["display_name"].split(",")[0]
                    area = addr.get("neighbourhood") or addr.get("suburb") or addr.get("city") or ""
                    dist_m = haversine_m(lat, lon, ilat, ilon) if (lat is not None and lon is not None) else None
                    dist_str = f"{round(dist_m)} m" if (dist_m is not None and dist_m < 1000) else (f"{dist_m/1000.0:.1f} km" if dist_m is not None else None)

                    item_key = f"{road.lower()}_{round(ilat, 3)}_{round(ilon, 3)}"
                    if item_key not in seen_names:
                        seen_names.add(item_key)
                        results.append({
                            "id": f"geo_{item['place_id']}",
                            "name": road,
                            "subtitle": item.get("display_name", road),
                            "area": area,
                            "category": item.get("type", "street"),
                            "lat": ilat,
                            "lon": ilon,
                            "distance_m": round(dist_m) if dist_m is not None else None,
                            "distance_str": dist_str,
                            "type": "street_address"
                        })
        except Exception:
            pass

    # 3. Local POIs (if matching)
    places = repo.get_all_places()
    for p in places:
        if clean in p["name"].lower():
            plat, plon = p["lat"], p["lon"]
            dist_m = haversine_m(lat, lon, plat, plon) if (lat is not None and lon is not None) else None
            dist_str = f"{round(dist_m)} m" if (dist_m is not None and dist_m < 1000) else (f"{dist_m/1000.0:.1f} km" if dist_m is not None else None)
            item_key = f"{p['name'].lower()}_{round(plat, 3)}_{round(plon, 3)}"
            if item_key not in seen_names:
                seen_names.add(item_key)
                results.append({
                    "id": p["id"],
                    "name": p["name"],
                    "subtitle": f"{p['category'].replace('_', ' ')} • Step-Free Accessible",
                    "area": "Walkway",
                    "category": p["category"],
                    "lat": plat,
                    "lon": plon,
                    "distance_m": round(dist_m) if dist_m is not None else None,
                    "distance_str": dist_str,
                    "type": "campus_place"
                })

    # Sort results by proximity if user coordinates provided
    if lat is not None and lon is not None:
        results.sort(key=lambda x: x["distance_m"] if x["distance_m"] is not None else float("inf"))

    return results[:8]

@router.post("/routes", response_model=RouteResponse)
def calculate_route(req: RouteRequest):
    origin_id = req.origin_place_id
    destination_id = req.destination_place_id

    places = {p["id"]: p for p in repo.get_all_places()}
    all_nodes = repo.get_all_nodes()
    node_by_id = {n["id"]: n for n in all_nodes}

    # Resolve Origin
    origin_node = None
    if req.origin_point and len(req.origin_point) >= 2:
        origin_node, _ = routing_engine.find_nearest_node(req.origin_point[0], req.origin_point[1])
    elif origin_id in places:
        entrances = places[origin_id]["entrance_node_ids"]
        origin_node = entrances[0] if entrances else None
    elif origin_id in node_by_id:
        origin_node = origin_id
    elif origin_id:
        origin_node, _, _ = resolve_text_destination(origin_id, places, all_nodes)

    # Resolve Destination
    dest_node = None
    dest_display_name = None
    resolved_dest_point = req.destination_point

    if req.destination_point and len(req.destination_point) >= 2:
        dest_node, _ = routing_engine.find_nearest_node(req.destination_point[0], req.destination_point[1])
        dest_display_name = f"Selected Map Pin ({req.destination_point[0]:.4f}, {req.destination_point[1]:.4f})"
    elif destination_id in places:
        entrances = places[destination_id]["entrance_node_ids"]
        dest_node = entrances[0] if entrances else None
        dest_display_name = places[destination_id]["name"]
        resolved_dest_point = [places[destination_id]["lat"], places[destination_id]["lon"]]
    elif destination_id in node_by_id:
        dest_node = destination_id
        dest_display_name = node_by_id[destination_id]["name"]
        resolved_dest_point = [node_by_id[destination_id]["lat"], node_by_id[destination_id]["lon"]]
    elif destination_id:
        dest_node, resolved_dest_point, dest_display_name = resolve_text_destination(destination_id, places, all_nodes)

    if not origin_node:
        origin_node = all_nodes[0]["id"] if all_nodes else None

    if not dest_node:
        dest_node = all_nodes[-1]["id"] if all_nodes else None

    if not origin_node or not dest_node:
        raise HTTPException(
            status_code=400,
            detail="Could not resolve origin or destination to accessible network nodes."
        )

    # Calculate core route using Dijkstra
    response = routing_engine.calculate_route(
        origin_node_id=origin_node,
        destination_node_id=dest_node,
        profile=req.profile,
        strictness=req.strictness
    )

    # Connect exact origin GPS and destination pin to geometry
    if response.status == "ok" and response.geometry and "features" in response.geometry:
        features = response.geometry["features"]
        added_steps_front = []
        added_steps_back = []
        added_distance = 0.0

        # 1. Connect origin_point to first graph node if > 4m
        if req.origin_point and len(req.origin_point) >= 2 and features:
            first_coords = features[0]["geometry"]["coordinates"][0]  # [lon, lat]
            dist_to_first = haversine_m(req.origin_point[0], req.origin_point[1], first_coords[1], first_coords[0])
            if dist_to_first >= 4.0:
                features[0]["geometry"]["coordinates"].insert(0, [req.origin_point[1], req.origin_point[0]])
                added_distance += dist_to_first
                dist_str = f"{round(dist_to_first)}m" if dist_to_first < 1000 else f"{dist_to_first/1000.0:.1f} km"
                added_steps_front.append(RouteStep(
                    edge_id="origin_connector",
                    name="Origin Departure Walkway",
                    instruction=f"Depart from your real-time GPS location towards {node_by_id.get(origin_node, {}).get('name', 'accessible walkway')} ({dist_str})",
                    distance_m=round(dist_to_first, 1),
                    surface="paved",
                    stairs=False,
                    roughness=0.0
                ))

        # 2. Connect last graph node to resolved_dest_point if > 4m
        if resolved_dest_point and len(resolved_dest_point) >= 2 and features:
            last_coords = features[-1]["geometry"]["coordinates"][-1]  # [lon, lat]
            dist_to_dest = haversine_m(last_coords[1], last_coords[0], resolved_dest_point[0], resolved_dest_point[1])
            if dist_to_dest >= 4.0:
                features[-1]["geometry"]["coordinates"].append([resolved_dest_point[1], resolved_dest_point[0]])
                added_distance += dist_to_dest
                dist_str = f"{round(dist_to_dest)}m" if dist_to_dest < 1000 else f"{dist_to_dest/1000.0:.1f} km"
                added_steps_back.append(RouteStep(
                    edge_id="dest_connector",
                    name="Destination Approach",
                    instruction=f"Continue towards destination: {dest_display_name or 'Destination'} ({dist_str})",
                    distance_m=round(dist_to_dest, 1),
                    surface="paved",
                    stairs=False,
                    roughness=0.0
                ))

        if added_steps_front or added_steps_back:
            response.steps = added_steps_front + response.steps + added_steps_back
            response.total_distance_m = round(response.total_distance_m + added_distance, 1)
            response.actual_length_m = round(response.actual_length_m + added_distance, 1)
            response.turn_count = sum(1 for s in response.steps if "turn " in s.instruction.lower())

        if dest_display_name and not any(r in response.reason_codes for r in ("BLOCKED_EDGE_AVOIDED", "UNVERIFIED_BLOCKAGE_AVOIDED", "NO_ROUTE_MEETING_CONSTRAINTS")):
            tot_str = f"{round(response.total_distance_m)}m" if response.total_distance_m < 1000 else f"{response.total_distance_m/1000.0:.1f} km"
            response.explanation = f"Accessible route to {dest_display_name} ({tot_str}). All known barriers and stairs avoided."

    return response
