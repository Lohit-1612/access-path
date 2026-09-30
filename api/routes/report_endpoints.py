import shutil
import uuid
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, status
from fastapi.responses import JSONResponse, FileResponse
from api.repository import repo
from api.schemas import ReportPatch, ReviewCreate, ReviewResponse, ReportDetail, JobResponse
from api.routing import routing_engine
from api.config import settings
from worker.detector import detector
from worker.job_runner import process_single_job

router = APIRouter(tags=["reports"])

@router.post("/reports", status_code=status.HTTP_202_ACCEPTED)
async def submit_report(
    category: str = Form("blockage"),
    lat: float = Form(...),
    lon: float = Form(...),
    accuracy_m: float = Form(5.0),
    notes: Optional[str] = Form(None),
    sample_key: Optional[str] = Form(None),
    image: Optional[UploadFile] = File(None)
):
    """
    Stage 1 & 2: Accept report and media, queue inference job, return HTTP 202.
    """
    report_id = repo.create_draft_report(
        category=category,
        lat=lat,
        lon=lon,
        accuracy_m=accuracy_m,
        notes=notes
    )

    # Determine image destination
    upload_filename = f"{report_id}_{uuid.uuid4().hex[:8]}.jpg"
    dest_path = settings.UPLOAD_DIR / upload_filename

    if image and image.filename:
        with open(dest_path, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
    elif sample_key:
        # Load bundled sample image
        sample_path = settings.DATA_DIR / "sample_images" / sample_key
        if sample_path.exists():
            shutil.copyfile(sample_path, dest_path)
        else:
            # Fallback to creating a test image
            from PIL import Image
            test_img = Image.new("RGB", (640, 480), color=(200, 100, 50))
            test_img.save(dest_path, "JPEG")
    else:
        # Create a default placeholder image
        from PIL import Image
        test_img = Image.new("RGB", (640, 480), color=(100, 150, 200))
        test_img.save(dest_path, "JPEG")

    # Validate image and strip EXIF
    _, file_hash = detector.validate_and_preprocess_image(str(dest_path))

    media_id = repo.attach_media_to_report(
        report_id=report_id,
        object_key=upload_filename,
        file_path=str(dest_path),
        sha256_hash=file_hash,
        mime_type="image/jpeg"
    )

    # Create asynchronous job
    job_id = repo.create_job(
        job_type="barrier_detection",
        payload={
            "report_id": report_id,
            "media_id": media_id,
            "file_path": str(dest_path),
            "category": category
        }
    )

    # Automatically process job synchronously or trigger worker so UI doesn't hang in demo!
    # Claim and execute immediately
    job_record = repo.get_job(job_id)
    if job_record and job_record["state"] == "queued":
        process_single_job(job_record)

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={
            "report_id": report_id,
            "job_id": job_id,
            "status": "draft",
            "message": "Report received and barrier detection queued."
        }
    )

@router.get("/jobs/{job_id}", response_model=JobResponse)
def get_job_status(job_id: str):
    job = repo.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@router.get("/reports/{report_id}", response_model=ReportDetail)
def get_report_detail(report_id: str):
    rep = repo.get_report(report_id)
    if not rep:
        raise HTTPException(status_code=404, detail="Report not found")

    # Find candidate edges near report pin
    candidates = routing_engine.find_candidate_edges_for_pin(rep["lat"], rep["lon"], radius_m=35.0)

    image_url = None
    if rep["media"]:
        image_url = f"/api/media/{rep['media']['id']}"

    return {
        "id": rep["id"],
        "category": rep["category"],
        "status": rep["status"],
        "lat": rep["lat"],
        "lon": rep["lon"],
        "accuracy_m": rep["accuracy_m"],
        "observed_at": rep["observed_at"],
        "version": rep["version"],
        "notes": rep["notes"],
        "image_url": image_url,
        "detections": rep["detections"],
        "affected_edges": rep["affected_edges"],
        "candidate_edges": candidates,
        "reviews": rep["reviews"],
        "created_at": rep["created_at"],
        "updated_at": rep["updated_at"]
    }

@router.patch("/reports/{report_id}")
def patch_report(report_id: str, patch_data: ReportPatch):
    """
    Stage 3: Reporter confirms or corrects AI suggestions, picks affected edges, and submits for verification.
    """
    try:
        updated = repo.patch_report_and_submit(
            report_id=report_id,
            corrected_category=patch_data.corrected_category,
            affected_edge_ids=patch_data.affected_edge_ids,
            extent=patch_data.extent,
            direction=patch_data.direction,
            notes=patch_data.notes,
            expected_version=patch_data.expected_version
        )
        return updated
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.post("/reports/{report_id}/reviews", response_model=ReviewResponse)
def submit_review(report_id: str, review: ReviewCreate):
    """
    Stage 4 & 5: Verifier reviews evidence and changes state (verify, dispute, reject, resolve).
    Increments graph revision and publishes event.
    """
    try:
        result = repo.add_review(
            report_id=report_id,
            action=review.action,
            reason=review.reason,
            expected_version=review.expected_version,
            actor_name=review.actor_name or "Campus Verifier"
        )
        return result
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/media/{media_id}")
def serve_media(media_id: str):
    from api.database import get_db
    with get_db() as conn:
        row = conn.execute("SELECT file_path, mime_type FROM media WHERE id = ?", (media_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Media not found")
        path = Path(row["file_path"])
        if not path.exists():
            raise HTTPException(status_code=404, detail="File on disk missing")
        return FileResponse(str(path), media_type=row["mime_type"])

import base64
from pydantic import BaseModel

class LiveVisionRequest(BaseModel):
    image_base64: Optional[str] = None
    hint_category: Optional[str] = None
    language: Optional[str] = "en"

OBSTACLE_NAMES = {
    "construction": {
        "en": "Construction barricade",
        "ta": "கட்டுமான தடுப்பு",
        "hi": "निर्माण अवरोध",
        "te": "నిర్మాణ అడ్డంకి",
        "es": "barricada de construcción",
        "fr": "barricade de chantier",
        "de": "Baustellenabsperrung"
    },
    "stairs": {
        "en": "Flight of stairs or steps",
        "ta": "படிக்கட்டுகள்",
        "hi": "सीढ़ियाँ",
        "te": "మెట్లు",
        "es": "escaleras o escalones",
        "fr": "escaliers ou marches",
        "de": "Treppenstufen"
    },
    "damaged_surface": {
        "en": "Pothole or broken surface",
        "ta": "உடைந்த நடைபாதை அல்லது பள்ளம்",
        "hi": "गड्ढा या टूटा हुआ मार्ग",
        "te": "గుంత లేదా దెబ్బతిన్న మార్గం",
        "es": "bache o pavimento dañado",
        "fr": "nid-de-poule ou sol endommagé",
        "de": "Schlagloch"
    },
    "blockage": {
        "en": "Pathway blockage",
        "ta": "நடைபாதை அடைப்பு",
        "hi": "मार्ग अवरोध",
        "te": "మార్గ అడ్డంకి",
        "es": "camino bloqueado",
        "fr": "passage bloqué",
        "de": "Wegblockade"
    }
}

POSITION_ADVICE = {
    "center": {
        "en": "straight ahead. Caution, step aside.",
        "ta": "நேராக முன்னால் உள்ளது. எச்சரிக்கை, விலகிச் செல்லவும்.",
        "hi": "सीधे आगे है। सावधान, किनारे हटें।",
        "te": "నేరుగా ముందు ఉంది. జాగ్రత్త, పక్కకు వెళ్లండి.",
        "es": "justo adelante. Atención, desvíese.",
        "fr": "droit devant. Attention, écartez-vous.",
        "de": "geradeaus. Achtung, treten Sie zur Seite."
    },
    "left": {
        "en": "on your left. Please keep right.",
        "ta": "உங்கள் இடதுபுறம் உள்ளது. வலதுபுறமாக செல்லவும்.",
        "hi": "आपकी बाईं ओर है। कृपया दाईं ओर रहें।",
        "te": "మీ ఎடమవైపు ఉంది. కుడివైపు వెళ్లండి.",
        "es": "a su izquierda. Manténgase a la derecha.",
        "fr": "sur votre gauche. Serrez à droite.",
        "de": "zu Ihrer Linken. Bitte rechts halten."
    },
    "right": {
        "en": "on your right. Please keep left.",
        "ta": "உங்கள் வலதுபுறம் உள்ளது. இடதுபுறமாக செல்லவும்.",
        "hi": "आपकी दाईं ओर है। कृपया बाईं ओर रहें।",
        "te": "మీ కుడివైపు ఉంది. ఎడమవైపు వెళ్లండి.",
        "es": "a su derecha. Manténgase a la izquierda.",
        "fr": "sur votre droite. Serrez à gauche.",
        "de": "zu Ihrer Rechten. Bitte links halten."
    }
}

from fastapi import Request

@router.post("/vision/detect-obstacle")
async def detect_live_obstacle(
    request: Request,
    image: Optional[UploadFile] = File(None),
    hint_category: Optional[str] = Form(None),
    language: Optional[str] = Form(None)
):
    """
    Real-time vision obstacle detection for blind pedestrian navigation.
    Analyzes camera frames via OWLv2 / perceptual candidate detector,
    and returns detected obstacles with bounding box coordinates, distance, and localized voice alerts.
    """
    content_type = request.headers.get("content-type", "")
    target_hint = hint_category
    target_lang = language or "en"
    image_base64 = None

    if "application/json" in content_type:
        try:
            body = await request.json()
            if isinstance(body, dict):
                target_hint = body.get("hint_category", target_hint)
                target_lang = body.get("language", target_lang)
                image_base64 = body.get("image_base64")
        except Exception:
            pass

    target_lang = (target_lang or "en").lower()

    # Write temporary frame to disk for detector
    temp_filename = f"live_frame_{uuid.uuid4().hex[:8]}.jpg"
    temp_path = settings.UPLOAD_DIR / temp_filename

    try:
        if image and image.filename:
            with open(temp_path, "wb") as buffer:
                shutil.copyfileobj(image.file, buffer)
        elif image_base64:
            b64_data = image_base64
            if "," in b64_data:
                b64_data = b64_data.split(",", 1)[1]
            image_bytes = base64.b64decode(b64_data)
            with open(temp_path, "wb") as f:
                f.write(image_bytes)
        else:
            # Fallback test image
            from PIL import Image
            test_img = Image.new("RGB", (640, 480), color=(180, 100, 40))
            test_img.save(temp_path, "JPEG")

        # Run model inference
        raw_detections = detector.detect(str(temp_path), hint_category=target_hint)

        obstacles = []
        for det in raw_detections:
            x1, y1, x2, y2 = det["box_x1"], det["box_y1"], det["box_x2"], det["box_y2"]
            cx = (x1 + x2) / 2.0
            h = y2 - y1

            if cx < 0.38:
                pos = "left"
                action_key = "keep_right"
            elif cx > 0.62:
                pos = "right"
                action_key = "keep_left"
            else:
                pos = "center"
                action_key = "step_aside"

            if h > 0.45:
                dist_m = 1.5
            elif h > 0.25:
                dist_m = 2.8
            else:
                dist_m = 4.2

            cat = det.get("label", "blockage")
            obs_name = OBSTACLE_NAMES.get(cat, {}).get(target_lang, OBSTACLE_NAMES.get(cat, {}).get("en", cat))
            advice = POSITION_ADVICE.get(pos, {}).get(target_lang, POSITION_ADVICE.get(pos, {}).get("en", "Caution ahead."))

            if target_lang == "ta":
                warning_text = f"எச்சரிக்கை: {dist_m} மீட்டரில் {obs_name} {advice}"
            elif target_lang == "hi":
                warning_text = f"सावधान: {dist_m} मीटर में {obs_name} {advice}"
            elif target_lang == "te":
                warning_text = f"హెచ్చరిక: {dist_m} మీటర్లలో {obs_name} {advice}"
            elif target_lang == "es":
                warning_text = f"¡Atención: {obs_name} a {dist_m} metros {advice}"
            elif target_lang == "fr":
                warning_text = f"Attention: {obs_name} à {dist_m} mètres {advice}"
            elif target_lang == "de":
                warning_text = f"Achtung: {obs_name} in {dist_m} Metern {advice}"
            else:
                warning_text = f"Caution: {obs_name} detected {dist_m} meters {advice}"

            obstacles.append({
                "label": cat,
                "prompt": det.get("prompt", cat),
                "confidence": det.get("raw_score", 0.85),
                "position": pos,
                "suggested_action": action_key,
                "distance_approx_m": dist_m,
                "box": [x1, y1, x2, y2],
                "warning": warning_text
            })

        return {
            "status": "ok",
            "detected": len(obstacles) > 0,
            "count": len(obstacles),
            "obstacles": obstacles
        }
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except Exception:
                pass
