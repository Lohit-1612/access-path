import time
import sys
from pathlib import Path
from api.repository import repo
from worker.detector import detector

def process_single_job(job: dict) -> bool:
    job_id = job["id"]
    payload = job["payload"]
    file_path = payload.get("file_path")
    media_id = payload.get("media_id")

    print(f"[Worker] Claimed job {job_id} for file: {file_path}")
    if not file_path or not Path(file_path).exists():
        err = f"Image file not found: {file_path}"
        print(f"[Worker] Error: {err}")
        repo.fail_job(job_id, err)
        return False

    try:
        category = payload.get("category")
        detections = detector.detect(file_path, hint_category=category)
        print(f"[Worker] Detected {len(detections)} candidate barriers for job {job_id}")
        repo.save_job_results(job_id, media_id, detections)
        return True
    except Exception as e:
        err = f"Inference processing error: {str(e)}"
        print(f"[Worker] Exception in job {job_id}: {err}")
        repo.fail_job(job_id, err)
        return False

def run_worker_loop(poll_interval: float = 1.0, once: bool = False):
    print("[Worker] AccessPath Inference Worker started. Polling for queued barrier jobs...")
    while True:
        try:
            job = repo.claim_next_job(lease_seconds=60)
            if job:
                process_single_job(job)
            else:
                if once:
                    break
                time.sleep(poll_interval)
        except KeyboardInterrupt:
            print("[Worker] Stopping worker cleanly...")
            break
        except Exception as e:
            print(f"[Worker] Unexpected loop error: {e}")
            time.sleep(poll_interval)

if __name__ == "__main__":
    once = "--once" in sys.argv
    run_worker_loop(once=once)
