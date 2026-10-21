"""Run the Halifax front office web app.

    .venv/bin/python serve.py              # http://127.0.0.1:8000 (this machine only)
    .venv/bin/python serve.py --reload     # restart on code changes while editing
    APP_PASSWORD=... .venv/bin/python serve.py --host 0.0.0.0   # reachable from other devices; asks for the password
"""

import argparse

import uvicorn

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--reload", action="store_true")
    args = ap.parse_args()
    uvicorn.run("web.app:app", host=args.host, port=args.port, reload=args.reload)
