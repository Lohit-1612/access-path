import json
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
from api.database import get_db

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def parse_iso(dt_str: str) -> datetime:
    if not dt_str:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(dt_str)
    except Exception:
        return datetime.now(timezone.utc)

class Repository:
    def __init__(self):
        pass

    # --- GRAPH STATE & REVISION ---
    def get_graph_state(self) -> Dict[str, Any]:
        with get_db() as conn:
            row = conn.execute("SELECT revision, event_id, affected_edge_ids, updated_at FROM graph_state WHERE id = 1").fetchone()
            if not row:
                conn.execute(
                    "INSERT INTO graph_state (id, revision, event_id, affected_edge_ids, updated_at) VALUES (1, 1, 'init', '[]', ?)",
                    (utc_now_iso(),)
                )
                return {"revision": 1, "event_id": "init", "affected_edge_ids": []}
            return {
                "revision": row["revision"],
                "event_id": row["event_id"],
                "affected_edge_ids": json.loads(row["affected_edge_ids"] or "[]"),
                "updated_at": row["updated_at"]
            }

    def increment_graph_revision(self, affected_edge_ids: List[str], event_type: str, payload: Dict[str, Any]) -> int:
        with get_db() as conn:
            state = conn.execute("SELECT revision FROM graph_state WHERE id = 1").fetchone()
            current_rev = state["revision"] if state else 1
            new_rev = current_rev + 1
            event_id = f"evt-{uuid.uuid4()}"
            now = utc_now_iso()

            conn.execute(
                "INSERT INTO events (id, revision, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?)",
                (event_id, new_rev, event_type, json.dumps(payload), now)
            )

            conn.execute(
                """INSERT INTO graph_state (id, revision, event_id, affected_edge_ids, updated_at)
                   VALUES (1, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                   revision = excluded.revision,
                   event_id = excluded.event_id,
                   affected_edge_ids = excluded.affected_edge_ids,
                   updated_at = excluded.updated_at""",
                (new_rev, event_id, json.dumps(affected_edge_ids), now)
            )
            return new_rev

    # --- NODES, PLACES, EDGES ---
    def get_all_nodes(self) -> List[Dict[str, Any]]:
        with get_db() as conn:
            rows = conn.execute("SELECT * FROM nodes ORDER BY name ASC").fetchall()
            return [dict(r) for r in rows]

    def get_all_places(self) -> List[Dict[str, Any]]:
        with get_db() as conn:
            rows = conn.execute("SELECT * FROM places ORDER BY name ASC").fetchall()
            results = []
            for r in rows:
                d = dict(r)
                d["entrance_node_ids"] = json.loads(d["entrance_node_ids"] or "[]")
                results.append(d)
            return results

    def get_all_edges(self) -> List[Dict[str, Any]]:
        with get_db() as conn:
            rows = conn.execute("""
                SELECT e.*, 
                       fn.name AS from_name, fn.lat AS from_lat, fn.lon AS from_lon,
                       tn.name AS to_name, tn.lat AS to_lat, tn.lon AS to_lon
                FROM edges e
                JOIN nodes fn ON e.from_id = fn.id
                JOIN nodes tn ON e.to_id = tn.id
            """).fetchall()
            results = []
            for r in rows:
                d = dict(r)
                d["stairs"] = bool(d["stairs"])
                d["geom_parsed"] = json.loads(d["geom"])
                results.append(d)
            return results

    def get_edge_by_id(self, edge_id: str) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            row = conn.execute("""
                SELECT e.*, 
                       fn.name AS from_name, tn.name AS to_name
                FROM edges e
                JOIN nodes fn ON e.from_id = fn.id
                JOIN nodes tn ON e.to_id = tn.id
                WHERE e.id = ?
            """, (edge_id,)).fetchone()
            if not row:
                return None
            d = dict(row)
            d["stairs"] = bool(d["stairs"])
            d["geom_parsed"] = json.loads(d["geom"])
            return d

    # --- REPORTS & EVIDENCE LIFECYCLE ---
    def create_draft_report(self, category: str, lat: float, lon: float,
                            accuracy_m: float = 5.0, observed_at: Optional[str] = None,
                            notes: Optional[str] = None, reporter_id: Optional[str] = "usr-reporter-1") -> str:
        report_id = f"rep-{uuid.uuid4()}"
        now = utc_now_iso()
        obs = observed_at or now

        with get_db() as conn:
            conn.execute("""
                INSERT INTO reports (id, reporter_id, category, status, lat, lon, accuracy_m, observed_at, version, notes, created_at, updated_at)
                VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, 1, ?, ?, ?)
            """, (report_id, reporter_id, category, lat, lon, accuracy_m, obs, notes, now, now))
        return report_id

    def attach_media_to_report(self, report_id: str, object_key: str, file_path: str,
                               sha256_hash: str, mime_type: str = "image/jpeg") -> str:
        media_id = f"med-{uuid.uuid4()}"
        now = utc_now_iso()
        with get_db() as conn:
            conn.execute("""
                INSERT INTO media (id, report_id, object_key, file_path, sha256_hash, mime_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (media_id, report_id, object_key, file_path, sha256_hash, mime_type, now))
        return media_id

    def get_report(self, report_id: str) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
            if not row:
                return None
            rep = dict(row)

            # Get media
            media_row = conn.execute("SELECT * FROM media WHERE report_id = ? ORDER BY created_at DESC LIMIT 1", (report_id,)).fetchone()
            rep["media"] = dict(media_row) if media_row else None

            # Get detections
            if rep["media"]:
                det_rows = conn.execute("SELECT * FROM detections WHERE media_id = ?", (rep["media"]["id"],)).fetchall()
                rep["detections"] = [dict(d) for d in det_rows]
            else:
                rep["detections"] = []

            # Get report_edges
            edge_rows = conn.execute("SELECT edge_id, extent, direction, notes FROM report_edges WHERE report_id = ?", (report_id,)).fetchall()
            rep["affected_edges"] = [r["edge_id"] for r in edge_rows]
            rep["report_edge_details"] = [dict(r) for r in edge_rows]

            # Get reviews
            rev_rows = conn.execute("SELECT * FROM reviews WHERE report_id = ? ORDER BY timestamp DESC", (report_id,)).fetchall()
            rep["reviews"] = [dict(r) for r in rev_rows]

            return rep

    def patch_report_and_submit(self, report_id: str, corrected_category: Optional[str],
                                affected_edge_ids: List[str], extent: str, direction: str,
                                notes: Optional[str], expected_version: int) -> Dict[str, Any]:
        with get_db() as conn:
            row = conn.execute("SELECT version, status FROM reports WHERE id = ?", (report_id,)).fetchone()
            if not row:
                raise ValueError("Report not found")
            current_ver = row["version"]
            if current_ver != expected_version:
                raise KeyError(f"Conflict: Expected version {expected_version}, but found {current_ver}")

            new_ver = current_ver + 1
            now = utc_now_iso()

            # Update report status to pending for reviewer verification
            cat_update = corrected_category if corrected_category else None
            if cat_update:
                conn.execute("""
                    UPDATE reports 
                    SET category = ?, status = 'pending', version = ?, notes = COALESCE(?, notes), updated_at = ?
                    WHERE id = ?
                """, (cat_update, new_ver, notes, now, report_id))
            else:
                conn.execute("""
                    UPDATE reports 
                    SET status = 'pending', version = ?, notes = COALESCE(?, notes), updated_at = ?
                    WHERE id = ?
                """, (new_ver, notes, now, report_id))

            # Replace report_edges associations
            conn.execute("DELETE FROM report_edges WHERE report_id = ?", (report_id,))
            for eid in affected_edge_ids:
                conn.execute("""
                    INSERT INTO report_edges (id, report_id, edge_id, extent, direction, notes)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (f"re-{uuid.uuid4()}", report_id, eid, extent, direction, notes))

        return self.get_report(report_id)

    def add_review(self, report_id: str, action: str, reason: str,
                   expected_version: int, actor_name: str = "Campus Verifier",
                   actor_id: str = "usr-verifier-1") -> Dict[str, Any]:
        """
        Actions:
        - verify: transition from pending/disputed -> verified_active
        - dispute: transition -> disputed
        - reject: transition -> rejected
        - resolve: transition -> resolved (verified clearance)
        """
        action = action.lower()
        state_mapping = {
            "verify": "verified_active",
            "dispute": "disputed",
            "reject": "rejected",
            "resolve": "resolved"
        }
        if action not in state_mapping:
            raise ValueError(f"Unknown action {action}. Must be one of verify, dispute, reject, resolve.")

        new_state = state_mapping[action]

        with get_db() as conn:
            row = conn.execute("SELECT version, status FROM reports WHERE id = ?", (report_id,)).fetchone()
            if not row:
                raise ValueError("Report not found")
            current_ver = row["version"]
            old_state = row["status"]

            if current_ver != expected_version:
                raise KeyError(f"Conflict: Expected version {expected_version}, but report is at version {current_ver}")

            new_ver = current_ver + 1
            now = utc_now_iso()
            audit_id = f"rev-{uuid.uuid4()}"

            # Update report status
            conn.execute("""
                UPDATE reports SET status = ?, version = ?, updated_at = ? WHERE id = ?
            """, (new_state, new_ver, now, report_id))

            # Record review audit entry
            conn.execute("""
                INSERT INTO reviews (id, report_id, actor_id, actor_name, action, reason, old_state, new_state, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (audit_id, report_id, actor_id, actor_name, action, reason, old_state, new_state, now))

            # Find affected edges
            edge_rows = conn.execute("SELECT edge_id FROM report_edges WHERE report_id = ?", (report_id,)).fetchall()
            affected_edge_ids = [r["edge_id"] for r in edge_rows]

        # Increment graph revision atomically
        new_rev = self.increment_graph_revision(
            affected_edge_ids=affected_edge_ids,
            event_type=f"barrier_{new_state}",
            payload={
                "report_id": report_id,
                "action": action,
                "new_state": new_state,
                "reason": reason,
                "affected_edge_ids": affected_edge_ids
            }
        )

        return {
            "report_id": report_id,
            "old_state": old_state,
            "new_state": new_state,
            "audit_id": audit_id,
            "graph_revision": new_rev,
            "reason": reason,
            "timestamp": parse_iso(now)
        }

    def mark_active_barrier(self, category: str, lat: float, lon: float,
                            notes: Optional[str] = None, reporter_name: str = "User",
                            affected_edge_ids: Optional[List[str]] = None,
                            extent: str = "complete") -> Dict[str, Any]:
        """
        Directly mark and activate a barrier on the shared map so that all other users' routes immediately avoid it.
        """
        report_id = f"rep-{uuid.uuid4()}"
        now = utc_now_iso()
        obs = now

        edge_ids = list(affected_edge_ids) if affected_edge_ids else []
        if not edge_ids:
            # Auto-snap to nearest pedestrian edge(s) within radius
            from api.spatial import point_to_linestring_distance_m
            all_edges = self.get_all_edges()
            candidates = []
            for e in all_edges:
                coords = e["geom_parsed"]
                dist, _ = point_to_linestring_distance_m(lat, lon, coords)
                candidates.append((dist, e["id"]))
            candidates.sort(key=lambda x: x[0])
            if candidates and candidates[0][0] <= 90.0:
                edge_ids = [candidates[0][1]]
                closest_edge_id = candidates[0][1]
                target_e = next((e for e in all_edges if e["id"] == closest_edge_id), None)
                if target_e:
                    opp = next((e["id"] for e in all_edges if e["from_id"] == target_e["to_id"] and e["to_id"] == target_e["from_id"]), None)
                    if opp and opp not in edge_ids:
                        edge_ids.append(opp)

        with get_db() as conn:
            conn.execute("""
                INSERT INTO reports (id, reporter_id, category, status, lat, lon, accuracy_m, observed_at, version, notes, created_at, updated_at)
                VALUES (?, 'usr-reporter-1', ?, 'verified_active', ?, ?, 3.0, ?, 1, ?, ?, ?)
            """, (report_id, category, lat, lon, obs, notes, now, now))

            for eid in edge_ids:
                conn.execute("""
                    INSERT INTO report_edges (id, report_id, edge_id, extent, direction, notes)
                    VALUES (?, ?, ?, ?, 'both', ?)
                """, (f"re-{uuid.uuid4()}", report_id, eid, extent, notes))

            audit_id = f"rev-{uuid.uuid4()}"
            conn.execute("""
                INSERT INTO reviews (id, report_id, actor_id, actor_name, action, reason, old_state, new_state, timestamp)
                VALUES (?, ?, 'usr-verifier-1', ?, 'verify', 'Marked active barrier', 'none', 'verified_active', ?)
            """, (audit_id, report_id, reporter_name, now))

        new_rev = self.increment_graph_revision(
            affected_edge_ids=edge_ids,
            event_type="barrier_verified_active",
            payload={
                "report_id": report_id,
                "category": category,
                "lat": lat,
                "lon": lon,
                "notes": notes,
                "affected_edge_ids": edge_ids,
                "status": "verified_active"
            }
        )

        return {
            "status": "ok",
            "report_id": report_id,
            "category": category,
            "lat": lat,
            "lon": lon,
            "notes": notes,
            "affected_edge_ids": edge_ids,
            "graph_revision": new_rev,
            "message": f"Barrier '{category}' successfully marked. Pedestrian routing will now avoid this obstacle."
        }

    def delete_barrier(self, report_id: str, actor_name: str = "User", reason: str = "Cleared / deleted by user") -> Dict[str, Any]:
        """
        Delete or clear an active barrier, restoring the pathway for all users.
        """
        now = utc_now_iso()
        affected_edge_ids = []

        with get_db() as conn:
            row = conn.execute("SELECT id, status, version FROM reports WHERE id = ?", (report_id,)).fetchone()
            if not row:
                raise ValueError(f"Barrier report {report_id} not found")

            e_rows = conn.execute("SELECT edge_id FROM report_edges WHERE report_id = ?", (report_id,)).fetchall()
            affected_edge_ids = [e["edge_id"] for e in e_rows]

            new_ver = row["version"] + 1

            conn.execute("""
                UPDATE reports SET status = 'resolved', version = ?, updated_at = ? WHERE id = ?
            """, (new_ver, now, report_id))

            conn.execute("DELETE FROM report_edges WHERE report_id = ?", (report_id,))

            audit_id = f"rev-{uuid.uuid4()}"
            conn.execute("""
                INSERT INTO reviews (id, report_id, actor_id, actor_name, action, reason, old_state, new_state, timestamp)
                VALUES (?, ?, 'usr-verifier-1', ?, 'resolve', ?, ?, 'resolved', ?)
            """, (audit_id, report_id, actor_name, reason, row["status"], now))

        new_rev = self.increment_graph_revision(
            affected_edge_ids=affected_edge_ids,
            event_type="barrier_resolved",
            payload={
                "report_id": report_id,
                "action": "delete",
                "reason": reason,
                "affected_edge_ids": affected_edge_ids
            }
        )

        return {
            "status": "ok",
            "report_id": report_id,
            "graph_revision": new_rev,
            "message": "Barrier successfully deleted/cleared. Pathway is now restored and accessible for all users."
        }

    def list_barriers(self, status_filter: Optional[str] = None, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        with get_db() as conn:
            query = "SELECT * FROM reports"
            params = []
            if status_filter:
                query += " WHERE status = ?"
                params.append(status_filter)
            query += " ORDER BY observed_at DESC LIMIT ? OFFSET ?"
            params.extend([limit, offset])

            rows = conn.execute(query, params).fetchall()
            results = []
            now = datetime.now(timezone.utc)

            for r in rows:
                rep = dict(r)
                # Get media
                med = conn.execute("SELECT * FROM media WHERE report_id = ? LIMIT 1", (rep["id"],)).fetchone()
                rep["image_url"] = f"/api/media/{med['id']}" if med else None

                # Affected edges
                e_rows = conn.execute("SELECT edge_id FROM report_edges WHERE report_id = ?", (rep["id"],)).fetchall()
                rep["affected_edge_ids"] = [e["edge_id"] for e in e_rows]

                # Staleness check
                obs_dt = parse_iso(rep["observed_at"])
                age_h = (now - obs_dt).total_seconds() / 3600.0
                rep["freshness_hours"] = round(age_h, 1)

                is_stale = False
                if rep["category"] in ["blockage", "movable"] and age_h > 2.0:
                    is_stale = True
                elif rep["category"] == "construction" and age_h > 24.0:
                    is_stale = True
                elif age_h > 720.0:
                    is_stale = True
                rep["is_stale"] = is_stale

                results.append(rep)
            return results

    # --- JOBS & ASYNC INFERENCE ---
    def create_job(self, job_type: str, payload: Dict[str, Any]) -> str:
        job_id = f"job-{uuid.uuid4()}"
        now = utc_now_iso()
        with get_db() as conn:
            conn.execute("""
                INSERT INTO jobs (id, type, payload, state, attempts, max_attempts, created_at, updated_at)
                VALUES (?, ?, ?, 'queued', 0, 3, ?, ?)
            """, (job_id, job_type, json.dumps(payload), now, now))
        return job_id

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if not row:
                return None
            d = dict(row)
            d["payload"] = json.loads(d["payload"])
            d["result"] = json.loads(d["result"]) if d["result"] else None

            # Look up detections for this report if any
            media_row = conn.execute("SELECT id FROM media WHERE report_id = ? LIMIT 1", (d["payload"].get("report_id"),)).fetchone()
            if media_row:
                det_rows = conn.execute("SELECT * FROM detections WHERE media_id = ?", (media_row["id"],)).fetchall()
                d["detections"] = [dict(r) for r in det_rows]
            else:
                d["detections"] = []
            return d

    def claim_next_job(self, lease_seconds: int = 60) -> Optional[Dict[str, Any]]:
        now_dt = datetime.now(timezone.utc)
        now_iso = now_dt.isoformat()
        lease_until = (now_dt + timedelta(seconds=lease_seconds)).isoformat()

        with get_db() as conn:
            # Find queued job or expired running job
            row = conn.execute("""
                SELECT * FROM jobs 
                WHERE state = 'queued' OR (state = 'running' AND lease_until < ?)
                ORDER BY created_at ASC LIMIT 1
            """, (now_iso,)).fetchone()
            if not row:
                return None

            job_id = row["id"]
            attempts = row["attempts"] + 1

            conn.execute("""
                UPDATE jobs 
                SET state = 'running', attempts = ?, lease_until = ?, updated_at = ?
                WHERE id = ?
            """, (attempts, lease_until, now_iso, job_id))

            d = dict(row)
            d["attempts"] = attempts
            d["state"] = "running"
            d["payload"] = json.loads(d["payload"])
            return d

    def save_job_results(self, job_id: str, media_id: str, detections: List[Dict[str, Any]]) -> None:
        now = utc_now_iso()
        with get_db() as conn:
            # Insert detections
            for det in detections:
                conn.execute("""
                    INSERT INTO detections (id, media_id, box_x1, box_y1, box_x2, box_y2, label, raw_score, model_revision, prompt, is_precomputed, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    f"det-{uuid.uuid4()}",
                    media_id,
                    det["box_x1"], det["box_y1"], det["box_x2"], det["box_y2"],
                    det["label"], det["raw_score"],
                    det.get("model_revision", "google/owlv2-base-patch16"),
                    det.get("prompt", det["label"]),
                    1 if det.get("is_precomputed") else 0,
                    now
                ))

            # Mark job succeeded
            conn.execute("""
                UPDATE jobs 
                SET state = 'succeeded', result = ?, updated_at = ?
                WHERE id = ?
            """, (json.dumps({"detections_count": len(detections)}), now, job_id))

    def fail_job(self, job_id: str, error_message: str) -> None:
        now = utc_now_iso()
        with get_db() as conn:
            conn.execute("""
                UPDATE jobs SET state = 'failed', error = ?, updated_at = ? WHERE id = ?
            """, (error_message, now, job_id))

    # --- EVENTS FOR SSE & RECONNECT ---
    def get_events_since(self, last_event_id: Optional[str] = None, since_revision: Optional[int] = None) -> List[Dict[str, Any]]:
        with get_db() as conn:
            query = "SELECT * FROM events"
            params = []
            if since_revision is not None:
                query += " WHERE revision > ?"
                params.append(since_revision)
            query += " ORDER BY revision ASC LIMIT 100"
            rows = conn.execute(query, params).fetchall()
            results = []
            for r in rows:
                d = dict(r)
                d["payload"] = json.loads(d["payload"])
                results.append(d)
            return results

repo = Repository()
