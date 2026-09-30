import os
import sys
import subprocess
import time
import signal
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

def main():
    print("=" * 70)
    print("  AccessPath: Dynamic Accessibility Barrier Detection and Routing")
    print("  Vector Hacks 26 | Track VH-S03")
    print("=" * 70)

    # 1. Generate sample images if needed
    print("\n[1/4] Ensuring benchmark test images exist...")
    from data.generate_sample_images import create_sample_images
    create_sample_images()

    # 2. Seed database
    print("\n[2/4] Verifying and calibrating database fixtures...")
    from data.seed_data import seed_database
    seed_database()

    # 3. Check for npm
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"

    processes = []

    def cleanup():
        print("\nShutting down all processes...")
        for p in processes:
            try:
                p.terminate()
                p.wait(timeout=3)
            except Exception:
                p.kill()
        print("All processes cleanly stopped.")

    try:
        # Launch Backend FastAPI
        print("\n[3/4] Launching FastAPI Backend on http://127.0.0.1:8000 ...")
        api_proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "api.main:app", "--host", "127.0.0.1", "--port", "8000"],
            cwd=str(BASE_DIR)
        )
        processes.append(api_proc)

        # Launch Background Worker
        print("\n[3.5/4] Launching Background Barrier Inference Worker...")
        worker_proc = subprocess.Popen(
            [sys.executable, "-m", "worker.job_runner"],
            cwd=str(BASE_DIR)
        )
        processes.append(worker_proc)

        time.sleep(2)

        # Launch Frontend Vite Server
        web_dir = BASE_DIR / "web"
        print("\n[4/4] Launching Frontend Interface on http://localhost:5173 ...")
        web_proc = subprocess.Popen(
            [npm_cmd, "run", "dev"],
            cwd=str(web_dir),
            shell=(sys.platform == "win32")
        )
        processes.append(web_proc)

        print("\n" + "=" * 70)
        print("  ✓ AccessPath is LIVE and running!")
        print("  - Web Application:    http://localhost:5173")
        print("  - Interactive API:    http://127.0.0.1:8000/docs")
        print("  - Health Check:       http://127.0.0.1:8000/api/health")
        print("  - Real-Time SSE:      http://127.0.0.1:8000/api/events")
        print("=" * 70)
        print("Press Ctrl+C to stop all servers.\n")

        # Keep alive
        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        cleanup()
    except Exception as e:
        print(f"Error starting project: {e}")
        cleanup()

if __name__ == "__main__":
    main()
