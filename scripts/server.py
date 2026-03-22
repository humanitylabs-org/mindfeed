#!/usr/bin/env python3
"""
MindFeed server — serves the spaced repetition app and handles state persistence.
Usage: python3 server.py [--port 8787] [--dir /path/to/data]
"""

import http.server
import json
import os
import sys
import argparse

DEFAULT_PORT = 8787

def get_args():
    parser = argparse.ArgumentParser(description="MindFeed server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--dir", type=str, default=None,
                        help="Data directory containing cards.json (default: skill directory)")
    parser.add_argument("--host", type=str, default="0.0.0.0",
                        help="Bind address (default: 0.0.0.0, use 127.0.0.1 for localhost only)")
    return parser.parse_args()

args = get_args()
SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = args.dir or SKILL_DIR
ASSETS_DIR = os.path.join(SKILL_DIR, "assets")

# Ensure cards.json exists
cards_path = os.path.join(DATA_DIR, "cards.json")
if not os.path.exists(cards_path):
    example = os.path.join(SKILL_DIR, "references", "example-cards.json")
    if os.path.exists(example):
        import shutil
        shutil.copy(example, cards_path)
        print(f"Created cards.json from example cards")
    else:
        with open(cards_path, "w") as f:
            f.write("[]")

# Ensure review-state.json exists
state_path = os.path.join(DATA_DIR, "review-state.json")
if not os.path.exists(state_path):
    with open(state_path, "w") as f:
        f.write("{}")


class VaultReviewHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        # Health check
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return

        # Serve manifest
        if self.path == "/manifest.json":
            self._serve_file(os.path.join(ASSETS_DIR, "manifest.json"), "application/manifest+json")
            return

        # Route requests
        if self.path == "/" or self.path == "":
            self._serve_file(os.path.join(ASSETS_DIR, "index.html"), "text/html")
        elif self.path.startswith("/cards.json"):
            self._serve_file(cards_path, "application/json")
        elif self.path.startswith("/review-state.json"):
            self._serve_file(state_path, "application/json")
        else:
            # Try assets directory
            clean = self.path.lstrip("/").split("?")[0]
            asset = os.path.join(ASSETS_DIR, clean)
            if os.path.exists(asset):
                ct = "text/html" if clean.endswith(".html") else "application/octet-stream"
                self._serve_file(asset, ct)
            else:
                self.send_response(404)
                self.end_headers()

    def do_PUT(self):
        if self.path == "/review-state.json":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                json.loads(body)  # validate
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
        else:
            self.send_response(404)
            self.end_headers()

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
    print(f"🔄 MindFeed server on http://localhost:{args.port}")
    print(f"   Data: {DATA_DIR}")
    server = http.server.HTTPServer((args.host, args.port), VaultReviewHandler)
    server.serve_forever()
