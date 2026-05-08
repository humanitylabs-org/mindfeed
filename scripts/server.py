#!/usr/bin/env python3
"""
MindFeed server — serves the spaced repetition app and handles state persistence.
Usage: python3 server.py [--port 8787] [--dir /path/to/data] [--base-path /mindfeed]
"""

import argparse
import http.server
import json
import mimetypes
import os
from urllib.parse import urlsplit

DEFAULT_PORT = int(os.environ.get("MINDFEED_PORT", "8787"))
DEFAULT_HOST = os.environ.get("MINDFEED_HOST", "0.0.0.0")
DEFAULT_BASE_PATH = os.environ.get("MINDFEED_BASE_PATH", "/mindfeed")


def normalize_base_path(value: str) -> str:
    raw = (value or "").strip()
    if raw in ("", "/"):
        return ""
    raw = raw.strip("/")
    return f"/{raw}" if raw else ""


def get_args():
    parser = argparse.ArgumentParser(description="MindFeed server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--dir",
        type=str,
        default=None,
        help="Data directory containing cards.json (default: skill directory)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default=DEFAULT_HOST,
        help="Bind address (default: 0.0.0.0, use 127.0.0.1 for localhost only)",
    )
    parser.add_argument(
        "--base-path",
        type=str,
        default=DEFAULT_BASE_PATH,
        help="Path prefix for hosting behind Tailscale Serve (example: /mindfeed)",
    )
    return parser.parse_args()


args = get_args()
BASE_PATH = normalize_base_path(args.base_path)
SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = args.dir or SKILL_DIR
ASSETS_DIR = os.path.join(SKILL_DIR, "assets")

os.makedirs(DATA_DIR, exist_ok=True)

# Ensure cards.json exists
cards_path = os.path.join(DATA_DIR, "cards.json")
if not os.path.exists(cards_path):
    example = os.path.join(SKILL_DIR, "references", "example-cards.json")
    if os.path.exists(example):
        import shutil

        shutil.copy(example, cards_path)
        print("Created cards.json from example cards")
    else:
        with open(cards_path, "w") as f:
            f.write("[]")

# Ensure review-state.json exists
state_path = os.path.join(DATA_DIR, "review-state.json")
if not os.path.exists(state_path):
    with open(state_path, "w") as f:
        f.write("{}")


class VaultReviewHandler(http.server.BaseHTTPRequestHandler):
    def _map_local_path(self):
        parsed = urlsplit(self.path)
        request_path = parsed.path or "/"

        if BASE_PATH:
            if request_path == BASE_PATH or request_path == f"{BASE_PATH}/":
                return "/"
            prefix = f"{BASE_PATH}/"
            if request_path.startswith(prefix):
                stripped = request_path[len(BASE_PATH) :]
                return stripped if stripped.startswith("/") else f"/{stripped}"
            return None

        return request_path

    def _index_html(self):
        with open(os.path.join(ASSETS_DIR, "index.html"), "r", encoding="utf-8") as f:
            html = f.read()

        base = BASE_PATH or ""
        return html.replace("__MINDFEED_BASE_PATH__", base)

    def _manifest_json(self):
        manifest_path = os.path.join(ASSETS_DIR, "manifest.json")
        with open(manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        base = BASE_PATH or ""
        scoped_root = f"{base}/" if base else "/"
        data["id"] = scoped_root
        data["start_url"] = scoped_root
        data["scope"] = scoped_root
        return json.dumps(data)

    def _safe_asset_path(self, clean_path: str):
        candidate = os.path.abspath(os.path.join(ASSETS_DIR, clean_path))
        assets_root = os.path.abspath(ASSETS_DIR)
        if not candidate.startswith(assets_root + os.sep) and candidate != assets_root:
            return None
        return candidate

    def do_GET(self):
        local_path = self._map_local_path()
        if local_path is None:
            self.send_response(404)
            self.end_headers()
            return

        if local_path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return

        if local_path == "/manifest.json":
            payload = self._manifest_json().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/manifest+json")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(payload)
            return

        if local_path in ("/", ""):
            payload = self._index_html().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(payload)
            return

        if local_path == "/sw.js":
            self._serve_file(os.path.join(ASSETS_DIR, "sw.js"), "application/javascript")
            return

        if local_path.startswith("/cards.json"):
            self._serve_file(cards_path, "application/json")
            return

        if local_path.startswith("/review-state.json"):
            self._serve_file(state_path, "application/json")
            return

        clean = local_path.lstrip("/").split("?")[0]
        asset = self._safe_asset_path(clean)
        if asset and os.path.exists(asset):
            guessed, _ = mimetypes.guess_type(asset)
            self._serve_file(asset, guessed or "application/octet-stream")
            return

        self.send_response(404)
        self.end_headers()

    def do_PUT(self):
        local_path = self._map_local_path()
        if local_path != "/review-state.json":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        try:
            json.loads(body)  # validate JSON
            with open(state_path, "wb") as f:
                f.write(body)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        except Exception as e:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(str(e).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _serve_file(self, path, content_type):
        try:
            with open(path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, format, *args):
        pass  # Suppress default logging


if __name__ == "__main__":
    path_display = BASE_PATH if BASE_PATH else "/"
    print(f"🔄 MindFeed server on http://{args.host}:{args.port}{path_display}")
    print(f"   Data: {DATA_DIR}")
    if BASE_PATH:
        print(f"   Base path: {BASE_PATH}")

    server = http.server.HTTPServer((args.host, args.port), VaultReviewHandler)
    server.serve_forever()
