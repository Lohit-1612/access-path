import math
from typing import List, Tuple, Dict, Any, Optional

EARTH_RADIUS_M = 6371000.0

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great circle distance in metres between two points on Earth."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return EARTH_RADIUS_M * c

def point_to_segment_distance_m(p_lat: float, p_lon: float,
                                a_lat: float, a_lon: float,
                                b_lat: float, b_lon: float) -> Tuple[float, Tuple[float, float]]:
    """
    Compute distance in metres from point P to line segment AB,
    and return (distance_m, (snap_lat, snap_lon)).
    Uses equirectangular projection centered at P for local precision.
    """
    # Scale degrees to local metres
    mean_lat_rad = math.radians(p_lat)
    m_per_deg_lat = 111132.954 - 559.822 * math.cos(2 * mean_lat_rad)
    m_per_deg_lon = 111412.84 * math.cos(mean_lat_rad)

    # Convert coordinates to local metric x, y relative to P
    ax = (a_lon - p_lon) * m_per_deg_lon
    ay = (a_lat - p_lat) * m_per_deg_lat
    bx = (b_lon - p_lon) * m_per_deg_lon
    by = (b_lat - p_lat) * m_per_deg_lat

    dx = bx - ax
    dy = by - ay
    seg_len_sq = dx * dx + dy * dy

    if seg_len_sq == 0:
        # A and B are the same point
        dist = math.sqrt(ax * ax + ay * ay)
        return dist, (a_lat, a_lon)

    # Projection factor t along AB
    t = max(0.0, min(1.0, -(ax * dx + ay * dy) / seg_len_sq))
    proj_x = ax + t * dx
    proj_y = ay + t * dy

    dist = math.sqrt(proj_x * proj_x + proj_y * proj_y)

    snap_lon = p_lon + proj_x / m_per_deg_lon
    snap_lat = p_lat + proj_y / m_per_deg_lat

    return dist, (snap_lat, snap_lon)

def point_to_linestring_distance_m(p_lat: float, p_lon: float,
                                   coords: List[List[float]]) -> Tuple[float, Tuple[float, float]]:
    """
    Distance in metres from point P to GeoJSON LineString coordinates [[lon, lat], ...].
    Returns (min_distance_m, (snap_lat, snap_lon)).
    """
    min_dist = float("inf")
    best_snap = (p_lat, p_lon)

    for i in range(len(coords) - 1):
        a_lon, a_lat = coords[i][0], coords[i][1]
        b_lon, b_lat = coords[i + 1][0], coords[i + 1][1]
        dist, snap = point_to_segment_distance_m(p_lat, p_lon, a_lat, a_lon, b_lat, b_lon)
        if dist < min_dist:
            min_dist = dist
            best_snap = snap

    return min_dist, best_snap

def linestring_length_m(coords: List[List[float]]) -> float:
    """Calculate the total length of a GeoJSON LineString [[lon, lat], ...] in metres."""
    total = 0.0
    for i in range(len(coords) - 1):
        total += haversine_m(coords[i][1], coords[i][0],
                             coords[i + 1][1], coords[i + 1][0])
    return total

def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate bearing from point 1 to point 2 in degrees (0-360)."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)
    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    brng = math.degrees(math.atan2(y, x))
    return (brng + 360.0) % 360.0

def get_compass_direction(bearing: float) -> str:
    """Get 8-point compass cardinal direction."""
    points = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]
    idx = round(bearing / 45.0) % 8
    return points[idx]
