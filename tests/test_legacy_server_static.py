"""Legacy scripts/server.py serves only files listed at start-up (issue 7).

Run: python3 -m unittest tests/test_legacy_server_static.py
"""

import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def raw_get(port, path):
    """Send the path byte for byte (urllib would normalise ../)."""
    with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
        s.sendall(f"GET {path} HTTP/1.0\r\nHost: x\r\n\r\n".encode())
        data = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            data += chunk
    head, _, body = data.partition(b"\r\n\r\n")
    return int(head.split()[1]), head.decode("latin-1"), body


class LegacyServerStatic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        skill = cls.tmp / "skill"
        (skill / "scripts").mkdir(parents=True)
        shutil.copy(REPO / "scripts" / "server.py", skill / "scripts" / "server.py")
        shutil.copytree(REPO / "assets", skill / "assets")
        outside = cls.tmp / "secret.txt"
        outside.write_text("TOP-SECRET")
        (skill / "assets" / "leak.txt").symlink_to(outside)
        (skill / "assets" / "leakdir").symlink_to(cls.tmp)
        (skill / "assets" / "inside.txt").symlink_to(skill / "assets" / "manifest.json")
        (skill / "assets" / "sub").mkdir()
        (skill / "assets" / "sub" / "note.css").write_text("body{}")
        cls.port = free_port()
        cls.proc = subprocess.Popen(
            [sys.executable, str(skill / "scripts" / "server.py"), "--host", "127.0.0.1",
             "--port", str(cls.port), "--dir", str(cls.tmp / "data"), "--base-path", "/mindfeed"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/mindfeed/health", timeout=1)
                break
            except (urllib.error.URLError, ConnectionError):
                time.sleep(0.1)
        # Added after start-up: must not be served (the list is fixed at start).
        (skill / "assets" / "late.txt").write_text("late")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(5)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def get(self, path):
        return raw_get(self.port, path)

    def test_listed_assets_are_served_with_their_type(self):
        code, head, body = self.get("/mindfeed/icon-192.png")
        self.assertEqual(code, 200)
        self.assertIn("Content-Type: image/png", head)
        self.assertTrue(body.startswith(b"\x89PNG"))
        code, head, _ = self.get("/mindfeed/sub/note.css")
        self.assertEqual(code, 200)
        self.assertIn("Content-Type: text/css", head)
        code, head, _ = self.get("/mindfeed/sw.js")
        self.assertEqual(code, 200)
        self.assertIn("Content-Type: application/javascript", head)

    def test_index_manifest_and_data_still_work(self):
        self.assertEqual(self.get("/mindfeed/")[0], 200)
        self.assertEqual(self.get("/mindfeed/manifest.json")[0], 200)
        self.assertEqual(self.get("/mindfeed/cards.json")[0], 200)
        self.assertEqual(self.get("/mindfeed/review-state.json")[0], 200)

    def test_traversal_is_refused(self):
        for path in ("/mindfeed/../scripts/server.py", "/mindfeed/..%2Fscripts%2Fserver.py",
                     "/mindfeed/%2e%2e/secret.txt", "/mindfeed//etc/passwd",
                     "/mindfeed/sub/../../scripts/server.py", "/mindfeed/assets/../../secret.txt"):
            code, _, body = self.get(path)
            self.assertEqual(code, 404, path)
            self.assertNotIn(b"TOP-SECRET", body)

    def test_symlink_out_of_assets_is_refused(self):
        for path in ("/mindfeed/leak.txt", "/mindfeed/leakdir/secret.txt"):
            code, _, body = self.get(path)
            self.assertEqual(code, 404, path)
            self.assertNotIn(b"TOP-SECRET", body)

    def test_symlink_inside_assets_is_served(self):
        self.assertEqual(self.get("/mindfeed/inside.txt")[0], 200)

    def test_files_added_after_start_are_not_served(self):
        self.assertEqual(self.get("/mindfeed/late.txt")[0], 404)

    def test_content_type_never_comes_from_the_request(self):
        code, head, _ = self.get("/mindfeed/icon-192.png%0d%0aX-Evil:%201")
        self.assertEqual(code, 404)
        self.assertNotIn("X-Evil", head)


if __name__ == "__main__":
    unittest.main()
