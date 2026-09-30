import json
import uuid
from datetime import datetime, timezone, timedelta
from api.database import init_db, get_db
from api.spatial import linestring_length_m

def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()

def seed_database(base_lat: float = 13.082700, base_lon: float = 80.270700, origin_street_name: str = None):
    init_db()

    origin_label = origin_street_name or "North Main Gate"

    with get_db() as conn:
        print(f"Clearing tables for reproducible seed centered at ({base_lat}, {base_lon})...")
        conn.execute("DELETE FROM detections")
        conn.execute("DELETE FROM media")
        conn.execute("DELETE FROM reviews")
        conn.execute("DELETE FROM report_edges")
        conn.execute("DELETE FROM reports")
        conn.execute("DELETE FROM jobs")
        conn.execute("DELETE FROM edges")
        conn.execute("DELETE FROM places")
        conn.execute("DELETE FROM nodes")
        conn.execute("DELETE FROM events")
        conn.execute("DELETE FROM graph_state")
        conn.execute("DELETE FROM users")

        print("Seeding users...")
        now = utc_now_iso()
        users_data = [
            ("usr-reporter-1", "reporter", "Alex Chen (Campus Reporter)", now),
            ("usr-verifier-1", "verifier", "Dr. Sarah Miller (Campus Verifier)", now),
            ("usr-admin-1", "admin", "Facilities Administrator", now)
        ]
        conn.executemany("INSERT INTO users VALUES (?, ?, ?, ?)", users_data)

        def deg_offset(dx_m, dy_m):
            dlat = dy_m / 111139.0
            dlon = dx_m / (111412.0 * 0.974)
            return round(base_lat + dlat, 6), round(base_lon + dlon, 6)

        print("Seeding nodes matching exact 500m / 650m / 720m worked example...")
        raw_nodes = [
            # Common North Approach (Anchored to user's real street location)
            ("n_gate", origin_label, "entrance", *deg_offset(0, 480)),
            ("n_gate_plaza", f"{origin_label} Plaza", "junction", *deg_offset(0, 440)),
            ("n_cross_north", "Main Concourse Crossing", "crossing", *deg_offset(0, 410)),
            ("n_fork", "Campus Gateway Fork", "junction", *deg_offset(0, 380)),

            # Route A (Central Shortest: 500m total with Great Hall Stairs)
            ("n_quad_entry", "Central Quad North Arch", "junction", *deg_offset(0, 310)),
            ("n_stair_top", "Great Hall Stairway Top", "kerb", *deg_offset(0, 250)),
            ("n_stair_bottom", "Great Hall Stairway Bottom", "kerb", *deg_offset(0, 230)),
            ("n_quad_center", "Central Quad Plaza", "junction", *deg_offset(0, 160)),
            ("n_quad_south", "Central Quad South Arch", "junction", *deg_offset(0, 80)),

            # Route B (Surveyed Step-Free East Footpath: 650m total)
            ("b_east_turn", "East Avenue Branch", "junction", *deg_offset(95, 340)),
            ("b_east_path_1", "East Footpath Upper Section", "junction", *deg_offset(115, 270)),
            ("b_east_cafe", "Student Hub & East Cafe Link", "junction", *deg_offset(125, 200)),
            ("b_east_path_2", "East Footpath Tree Walkway", "junction", *deg_offset(115, 130)),
            ("b_east_connector", "East Library Walk", "junction", *deg_offset(75, 60)),

            # Route C (Alternative Step-Free West Ramp Way: 720m total, +70m detour)
            ("c_west_turn", "West Promenade Branch", "junction", *deg_offset(-120, 345)),
            ("c_west_sci_cross", "West Science Pedestrian Crossing", "crossing", *deg_offset(-145, 280)),
            ("c_west_ramp_top", "Innovation Ramp Upper Landing", "kerb", *deg_offset(-155, 210)),
            ("c_west_ramp_mid", "Innovation Ramp Gentle Slope", "junction", *deg_offset(-150, 140)),
            ("c_west_path_2", "West Colonnade Walk", "junction", *deg_offset(-125, 80)),
            ("c_west_south_turn", "West Forecourt Connector", "junction", *deg_offset(-75, 45)),

            # Destination Forecourt and Entrance
            ("n_lib_forecourt", "Main Library Forecourt", "junction", *deg_offset(0, 20)),
            ("n_lib_entrance", "Main Library Step-Free Entrance", "entrance", *deg_offset(0, 0)),
            ("n_lib_revolving", "Main Library Revolving Doors", "entrance", *deg_offset(18, 5)),

            # Additional campus facilities
            ("n_science_hub", "Science & Tech Complex", "entrance", *deg_offset(-175, 250)),
            ("n_student_cafe", "Student Hub & Cafe", "dining", *deg_offset(150, 190)),
            ("n_eng_hall", "Engineering Hall", "academic", *deg_offset(135, 320)),
            ("n_sports_oval", "Sports Oval Gate", "recreation", *deg_offset(220, 360)),

            # Disconnected zone for testing honest "no_route" requirement
            ("n_disconnected_base", "South Escarpment Base", "junction", *deg_offset(0, -180)),
            ("n_disconnected_pavilion", "South Lookout Pavilion (Isolated)", "destination", *deg_offset(0, -320))
        ]

        node_map = {}
        for nid, name, ntype, lat, lon in raw_nodes:
            conn.execute("INSERT INTO nodes (id, name, type, lat, lon, level, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
                         (nid, name, ntype, lat, lon, now))
            node_map[nid] = (lat, lon)

        print("Seeding places...")
        places_data = [
            ("place_north_gate", origin_label, "gate", node_map["n_gate"][0], node_map["n_gate"][1], json.dumps(["n_gate"])),
            ("place_main_library", "Main Library", "library", node_map["n_lib_entrance"][0], node_map["n_lib_entrance"][1], json.dumps(["n_lib_entrance", "n_lib_revolving"])),
            ("place_science_centre", "Science Centre", "academic", node_map["n_science_hub"][0], node_map["n_science_hub"][1], json.dumps(["n_science_hub"])),
            ("place_student_cafe", "Student Hub & Cafe", "dining", node_map["n_student_cafe"][0], node_map["n_student_cafe"][1], json.dumps(["n_student_cafe"])),
            ("place_isolated_pavilion", "South Lookout Pavilion (Isolated)", "recreation", node_map["n_disconnected_pavilion"][0], node_map["n_disconnected_pavilion"][1], json.dumps(["n_disconnected_pavilion"]))
        ]
        conn.executemany("INSERT INTO places (id, name, category, lat, lon, entrance_node_ids) VALUES (?, ?, ?, ?, ?, ?)", places_data)

        print("Seeding edges...")
        edges_to_insert = []

        def add_edge_pair(eid_prefix, u_id, v_id, name, fixed_len=None, stairs=0, width_m=2.4, slope_pct=1.5, roughness=0.03, crossing_type=None, surface="concrete"):
            u_lat, u_lon = node_map[u_id]
            v_lat, v_lon = node_map[v_id]
            coords_fwd = [[u_lon, u_lat], [v_lon, v_lat]]
            coords_rev = [[v_lon, v_lat], [u_lon, u_lat]]
            dist = fixed_len if fixed_len is not None else round(linestring_length_m(coords_fwd), 1)

            edges_to_insert.append((
                f"{eid_prefix}_fwd", name, u_id, v_id, json.dumps(coords_fwd), dist,
                stairs, width_m, slope_pct, roughness, crossing_type, surface, now, "survey"
            ))
            edges_to_insert.append((
                f"{eid_prefix}_rev", name, v_id, u_id, json.dumps(coords_rev), dist,
                stairs, width_m, slope_pct, roughness, crossing_type, surface, now, "survey"
            ))

        # 1. Gate Concourse (Common: 100m total)
        add_edge_pair("e_gate_plaza", "n_gate", "n_gate_plaza", "North Gate Entry Plaza", fixed_len=40.0, width_m=3.5, slope_pct=0.5)
        add_edge_pair("e_plaza_cross", "n_gate_plaza", "n_cross_north", "Main Concourse Crossing", fixed_len=30.0, crossing_type="dropped_kerb", width_m=3.0)
        add_edge_pair("e_cross_fork", "n_cross_north", "n_fork", "Campus Fork North Concourse", fixed_len=30.0, width_m=3.0)

        # 2. Route A (Central direct: exactly 500m total with Great Hall stairs)
        # Fork to Quad: 70m
        # Quad North to Stair Top: 60m
        # Stairs: 20m (STAIRS = 1)
        # Stair Bottom to Center: 70m
        # Center to South: 80m
        # South to Forecourt: 60m
        # Forecourt to Entrance: 20m
        # Total = 100 (gate concourse) + 70 + 60 + 20 + 70 + 80 + 60 + 20 = 480m -> adjust to exactly 500m
        add_edge_pair("e_fork_quad", "n_fork", "n_quad_entry", "Central Quad North Path", fixed_len=75.0, width_m=2.5)
        add_edge_pair("e_quad_stairtop", "n_quad_entry", "n_stair_top", "Great Hall Upper Portico", fixed_len=65.0, width_m=2.5)
        add_edge_pair("e_stairs", "n_stair_top", "n_stair_bottom", "Great Hall Flight of Stairs (18 Steps)", fixed_len=20.0, stairs=1, width_m=2.0, slope_pct=28.0, surface="stone")
        add_edge_pair("e_stairbot_center", "n_stair_bottom", "n_quad_center", "Central Quad Paved Walk", fixed_len=70.0, width_m=2.8)
        add_edge_pair("e_center_south", "n_quad_center", "n_quad_south", "Central Quad South Arch", fixed_len=80.0, width_m=2.8)
        add_edge_pair("e_south_forecourt", "n_quad_south", "n_lib_forecourt", "Library North Gateway", fixed_len=70.0, width_m=3.0)
        add_edge_pair("e_forecourt_ent", "n_lib_forecourt", "n_lib_entrance", "Main Library Automatic Sliding Doors", fixed_len=20.0, width_m=2.4, slope_pct=0.0)
        add_edge_pair("e_forecourt_revolv", "n_lib_forecourt", "n_lib_revolving", "Main Library High-Traffic Revolving Door", fixed_len=22.0, width_m=1.2, stairs=0)

        # 3. Route B (East Footpath / Tree Walk: exactly 650m total, step-free)
        # Gate concourse: 100m
        # Fork to East Branch: 85m
        # East Branch to Upper Path: 95m
        # Upper Path to Cafe Link: 95m
        # Cafe Link to Tree Walkway (THE BLOCKED SEGMENT): 100m
        # Tree Walkway to Connector: 95m
        # Connector to Forecourt: 60m
        # Forecourt to Entrance: 20m
        # Total = 100 + 85 + 95 + 95 + 100 + 95 + 60 + 20 = 650m!
        add_edge_pair("e_fork_eastbranch", "n_fork", "b_east_turn", "East Avenue Promenade", fixed_len=85.0, width_m=2.4, slope_pct=1.5)
        add_edge_pair("e_east_path1", "b_east_turn", "b_east_path_1", "East Footpath Upper Section", fixed_len=95.0, width_m=2.2)
        add_edge_pair("e_path1_cafe", "b_east_path_1", "b_east_cafe", "Student Hub & Cafe Approach", fixed_len=95.0, width_m=2.2, crossing_type="tactile")
        add_edge_pair("e_east_blocked_segment", "b_east_cafe", "b_east_path_2", "East Footpath Tree Walkway", fixed_len=100.0, width_m=2.2, slope_pct=1.8, roughness=0.04)
        add_edge_pair("e_path2_conn", "b_east_path_2", "b_east_connector", "East Library Connection Walk", fixed_len=95.0, width_m=2.5)
        add_edge_pair("e_bconn_forecourt", "b_east_connector", "n_lib_forecourt", "East Forecourt Approach", fixed_len=60.0, width_m=2.8)

        # 4. Route C (West Ramp Way / Innovation Walk: exactly 720m total, step-free, +70m detour)
        # Gate concourse: 100m
        # Fork to West Branch: 95m
        # West Branch to Sci Crossing: 90m
        # Sci Crossing to Ramp Top: 95m
        # Ramp Top to Gentle Slope: 100m
        # Gentle Slope to West Colonnade: 90m
        # West Colonnade to Forecourt Connector: 70m
        # Connector to Forecourt: 60m
        # Forecourt to Entrance: 20m
        # Total = 100 + 95 + 90 + 95 + 100 + 90 + 70 + 60 + 20 = 720m!
        add_edge_pair("e_fork_westbranch", "n_fork", "c_west_turn", "West Promenade Branch", fixed_len=95.0, width_m=2.6, slope_pct=2.0)
        add_edge_pair("e_west_cross", "c_west_turn", "c_west_sci_cross", "West Science Pedestrian Crossing", fixed_len=90.0, crossing_type="dropped_kerb", width_m=2.6)
        add_edge_pair("e_cross_ramptop", "c_west_sci_cross", "c_west_ramp_top", "Innovation Ramp Upper Landing", fixed_len=95.0, width_m=2.5, slope_pct=3.8)
        add_edge_pair("e_ramptop_mid", "c_west_ramp_top", "c_west_ramp_mid", "Innovation Ramp Gentle Slope", fixed_len=100.0, width_m=2.5, slope_pct=4.2)
        add_edge_pair("e_rampmid_path2", "c_west_ramp_mid", "c_west_path_2", "West Colonnade Smooth Walk", fixed_len=90.0, width_m=2.5, slope_pct=1.0)
        add_edge_pair("e_path2_southturn", "c_west_path_2", "c_west_south_turn", "West Colonnade South Connector", fixed_len=70.0, width_m=2.5)
        add_edge_pair("e_southturn_forecourt", "c_west_south_turn", "n_lib_forecourt", "West Library Forecourt Link", fixed_len=60.0, width_m=2.8)

        # 5. Connectors to extra buildings
        add_edge_pair("e_sci_hub_conn", "c_west_sci_cross", "n_science_hub", "Science & Tech Entrance Link", fixed_len=35.0, width_m=2.4)
        add_edge_pair("e_student_cafe_conn", "b_east_cafe", "n_student_cafe", "Student Hub Dining Entrance", fixed_len=30.0, width_m=2.4)
        add_edge_pair("e_eng_hall_conn", "b_east_turn", "n_eng_hall", "Engineering Hall North Portico", fixed_len=45.0, width_m=2.0)
        add_edge_pair("e_sports_oval_conn", "b_east_turn", "n_sports_oval", "Sports Oval Eastern Gate", fixed_len=80.0, width_m=2.2)

        # 6. Disconnected test path (South isolated lookout pavilion)
        add_edge_pair("e_disc_spur", "n_disconnected_base", "n_disconnected_pavilion", "South Cliff Stairway to Isolated Lookout", fixed_len=140.0, stairs=1, width_m=1.0, slope_pct=35.0)

        conn.executemany("""
            INSERT INTO edges (id, name, from_id, to_id, geom, length_m, stairs, width_m, slope_pct, roughness, crossing_type, surface, checked_at, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, edges_to_insert)

        print("Seeding initial graph state (revision 1)...")
        conn.execute("INSERT INTO graph_state (id, revision, event_id, affected_edge_ids, updated_at) VALUES (1, 1, 'init', '[]', ?)", (now,))

        print("Seeding sample barrier reports for validation & demo...")
        # 1. Pothole / damaged surface near Science Quad (pending review)
        conn.execute("""
            INSERT INTO reports (id, reporter_id, category, status, lat, lon, accuracy_m, observed_at, version, notes, created_at, updated_at)
            VALUES ('rep-sample-damaged-surface', 'usr-reporter-1', 'damaged_surface', 'pending', ?, ?, 4.5, ?, 1, 'Cracked pavement tiles and pothole on Science Quad entrance approach.', ?, ?)
        """, (node_map["n_science_hub"][0], node_map["n_science_hub"][1], now, now, now))

        conn.execute("""
            INSERT INTO report_edges (id, report_id, edge_id, extent, direction, notes)
            VALUES ('re-edge-1', 'rep-sample-damaged-surface', 'e_sci_hub_conn_fwd', 'partial', 'forward', 'Pothole occupies right half of footpath.')
        """)

        conn.execute("""
            INSERT INTO media (id, report_id, object_key, file_path, sha256_hash, mime_type, created_at)
            VALUES ('med-sample-1', 'rep-sample-damaged-surface', 'sample_pothole_science.jpg', 'sample_images/pothole_sample.jpg', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'image/jpeg', ?)
        """, (now,))

        conn.execute("""
            INSERT INTO detections (id, media_id, box_x1, box_y1, box_x2, box_y2, label, raw_score, model_revision, prompt, is_precomputed, created_at)
            VALUES ('det-sample-1', 'med-sample-1', 0.22, 0.45, 0.74, 0.88, 'pothole', 0.88, 'google/owlv2-base-patch16', 'a pothole or cracked pavement', 1, ?)
        """, (now,))

        # 2. Stale scooter blockage (> 2 hours old)
        stale_time = (datetime.now(timezone.utc) - timedelta(hours=4)).isoformat()
        conn.execute("""
            INSERT INTO reports (id, reporter_id, category, status, lat, lon, accuracy_m, observed_at, version, notes, created_at, updated_at)
            VALUES ('rep-sample-stale-scooter', 'usr-reporter-1', 'blockage', 'stale', ?, ?, 3.0, ?, 1, 'Electric scooters left across pathway.', ?, ?)
        """, (node_map["b_east_path_2"][0], node_map["b_east_path_2"][1], stale_time, stale_time, now))

        conn.execute("""
            INSERT INTO report_edges (id, report_id, edge_id, extent, direction, notes)
            VALUES ('re-edge-2', 'rep-sample-stale-scooter', 'e_path2_conn_fwd', 'partial', 'both', 'Scooters parked horizontally.')
        """)

        # 3. Resolved construction report with audit log
        res_time = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        rev_time = (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()
        conn.execute("""
            INSERT INTO reports (id, reporter_id, category, status, lat, lon, accuracy_m, observed_at, version, notes, created_at, updated_at)
            VALUES ('rep-sample-resolved-construction', 'usr-reporter-1', 'construction', 'resolved', ?, ?, 2.0, ?, 2, 'Maintenance work on handrail has completed. Path cleared and inspected.', ?, ?)
        """, (node_map["c_west_ramp_mid"][0], node_map["c_west_ramp_mid"][1], res_time, res_time, now))

        conn.execute("""
            INSERT INTO reviews (id, report_id, actor_id, actor_name, action, reason, old_state, new_state, timestamp)
            VALUES ('rev-sample-1', 'rep-sample-resolved-construction', 'usr-verifier-1', 'Dr. Sarah Miller (Campus Verifier)', 'resolve', 'Handrail replacement finished; path inspected and certified clear.', 'verified_active', 'resolved', ?)
        """, (rev_time,))

    print("Database calibrated and seeded successfully!")

if __name__ == "__main__":
    seed_database()
