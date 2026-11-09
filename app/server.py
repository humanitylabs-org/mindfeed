#!/usr/bin/env python3
"""MindFeed server (stdlib only). Serves the feed UI and a small JSON API under APP_BASE_PATH.

Config (env):
  APP_HOST / APP_PORT / APP_BASE_PATH   listen address and URL prefix (default 127.0.0.1:8787, /mindfeed)
  MINDFEED_DATA                         state directory (default ./data)
  MINDFEED_SOURCES                      JSON list of sources, e.g.
      [{"type":"wisdom","url":"http://127.0.0.1:9230/","view":"/wisdom/","label":"Wisdom highlight"},
       {"type":"folder","path":"/path/to/wiki/mindfeed","label":"Philosopher","kind":"philosopher","prefix":"p"}]
  MINDFEED_ORIGINS                      comma-separated browser origins allowed to POST (same-origin always allowed)
  WIZARD_SETTINGS                       Wizard settings.json; its clock.timezone / clock.day_starts_at set the day
"""
from __future__ import annotations

import datetime as dt
import json
import mimetypes
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).parent))
from mindfeed import Feed  # noqa: E402

HOST = os.environ.get("APP_HOST", "127.0.0.1")
PORT = int(os.environ.get("APP_PORT", "8787"))
BASE = "/" + os.environ.get("APP_BASE_PATH", "/mindfeed").strip("/")
DATA = Path(os.environ.get("MINDFEED_DATA", str(Path(__file__).parent.parent / "data")))
WEB = (Path(__file__).parent / "web").resolve()
SETTINGS = Path(os.environ.get("WIZARD_SETTINGS", str(Path.home() / ".wizard-os/settings.json")))
try:
    SOURCES = json.loads(os.environ.get("MINDFEED_SOURCES", "[]"))
except ValueError:
    SOURCES = []
ORIGINS = {o.strip().rstrip("/") for o in os.environ.get("MINDFEED_ORIGINS", "").split(",") if o.strip()}
FEED = Feed(DATA, SOURCES)


def day_now() -> str:
    tz, start = os.environ.get("MINDFEED_TZ", "UTC"), "06:00"
    try:
        c = json.loads(SETTINGS.read_text()).get("clock") or {}
        tz, start = c.get("timezone") or tz, c.get("day_starts_at") or start
    except Exception:
        pass
    hh, mm = (int(x) for x in start.split(":")[:2])
    now = dt.datetime.now(ZoneInfo(tz))
    st = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if now < st:
        st -= dt.timedelta(days=1)
    return st.date().isoformat()


class H(BaseHTTPRequestHandler):
    server_version = "MindFeed/1"

    def log_message(self, *a):
        pass

    def rel(self) -> str:
        p = urlparse(self.path).path
        if p == BASE:
            return ""
        return p[len(BASE):] if p.startswith(BASE + "/") else None

    def send(self, code: int, body: bytes, ctype: str, cache: str = "no-store"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def json(self, obj, code: int = 200):
        self.send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n > 64 * 1024:
            raise ValueError("body too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def origin_ok(self) -> bool:
        o = (self.headers.get("Origin") or "").rstrip("/")
        if not o:
            return True  # non-browser caller on the box (agents, scripts)
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or ""
        return o in ORIGINS or urlparse(o).netloc == host

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        p = self.rel()
        if p is None:
            return self.json({"error": "not found"}, 404)
        if p == "":
            self.send_response(308)
            self.send_header("Location", BASE + "/")
            self.end_headers()
            return
        day = day_now()
        if p in ("/api/health", "/healthz"):
            return self.json({"ok": True, "app": "mindfeed"})
        if p == "/api/today":
            return self.json(FEED.today(day))
        if p == "/api/status":
            return self.json(FEED.status(day))
        if p == "/api/days":
            return self.json({"days": FEED.done_days(), "goal": 3})
        if p == "/api/cards":
            return self.json({"cards": FEED.library()})
        rel = "index.html" if p == "/" else p.lstrip("/")
        f = (WEB / rel).resolve()
        if WEB not in f.parents or not f.is_file():
            return self.json({"error": "not found"}, 404)
        self.send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] or "application/octet-stream", "no-cache")

    def do_POST(self):
        p = self.rel()
        if not self.origin_ok():
            return self.json({"error": "forbidden origin"}, 403)
        try:
            b = self.body()
        except ValueError:
            return self.json({"error": "bad json"}, 400)
        day = day_now()
        try:
            if p == "/api/rate":
                return self.json(FEED.rate(day, str(b.get("id")), int(b.get("r"))))
            if p == "/api/more":
                return self.json(FEED.today(day, more=True))
            if p == "/api/cards":
                out = FEED.add(text=b.get("text", ""), title=b.get("title", ""), attribution=b.get("attribution", ""),
                               domain=b.get("domain", ""), kind=b.get("kind", "idea"), note=b.get("note", ""),
                               added_by=str(b.get("added_by") or "owner"), source_label=b.get("source_label", ""),
                               card_id=b.get("id", ""))
                return self.json(out, 200 if out["updated"] else 201)
            if p == "/api/cards/archive":
                return self.json({"archived": FEED.archive(str(b.get("id")))})
        except (KeyError, ValueError, TypeError) as e:
            return self.json({"error": str(e).strip('"')}, 400)
        return self.json({"error": "not found"}, 404)


if __name__ == "__main__":
    DATA.mkdir(parents=True, exist_ok=True)
    print(f"MindFeed on http://{HOST}:{PORT}{BASE}/ ({len(SOURCES)} sources)", flush=True)
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
