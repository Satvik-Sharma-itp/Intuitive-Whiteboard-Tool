"""Tests for the user-icon API in run.py.  Run with:  python -m unittest tests/test_icons_api.py -v

The server is started from a throw-away copy of run.py in a temp folder, so the real icons/ folder is never touched.
"""
import base64
import http.client
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

RUN_PY = Path(__file__).resolve().parent.parent / "run.py"

# smallest valid PNG (1x1)
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
SVG_OK = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#09f"/></svg>'


def data_url(raw, mime="image/png"):
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


class IconApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="wb-test-"))
        shutil.copy(RUN_PY, cls.tmp / "run.py")
        (cls.tmp / "index.html").write_text("<!doctype html><title>t</title>", encoding="utf-8")
        (cls.tmp / "icons").mkdir()
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            cls.port = s.getsockname()[1]
        cls.proc = subprocess.Popen([sys.executable, "run.py", "--no-browser", "--port", str(cls.port)],
                                    cwd=cls.tmp, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", cls.port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("server did not start")
        cls.user = cls.tmp / "icons" / "user"

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def call(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"Host": f"localhost:{self.port}"}
        h.update(headers or {})
        payload = None
        if body is not None:
            payload = body if isinstance(body, bytes) else json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        conn.request(method, path, payload, h)
        r = conn.getresponse()
        raw = r.read()
        conn.close()
        try:
            return r.status, json.loads(raw), r
        except ValueError:
            return r.status, raw, r

    def upload(self, raw, name="My icon", filename="my icon.png", mime="image/png", **kw):
        return self.call("POST", "/api/icons", {"name": name, "filename": filename, "image": data_url(raw, mime)}, **kw)

    def manifest(self):
        return json.loads((self.user / "manifest.json").read_text(encoding="utf-8"))

    # ---- happy path ----
    def test_01_upload_png_is_saved_listed_and_served(self):
        status, body, _ = self.upload(PNG)
        self.assertEqual(status, 201, body)
        self.assertEqual(body["name"], "My icon")
        self.assertEqual(body["file"], "my-icon.png")
        self.assertEqual((self.user / "my-icon.png").read_bytes(), PNG)
        self.assertIn({"name": "My icon", "file": "my-icon.png"}, self.manifest())
        status, raw, resp = self.call("GET", "/icons/user/my-icon.png")
        self.assertEqual(status, 200)
        self.assertEqual(raw, PNG)
        self.assertIn("sandbox", resp.getheader("Content-Security-Policy", ""))
        self.assertEqual(resp.getheader("X-Content-Type-Options"), "nosniff")

    def test_02_same_name_gets_a_unique_file(self):
        self.upload(PNG, filename="dup.png")
        status, body, _ = self.upload(PNG, filename="dup.png")
        self.assertEqual(status, 201)
        self.assertEqual(body["file"], "dup-2.png")

    def test_03_safe_svg_is_accepted(self):
        status, body, _ = self.upload(SVG_OK, filename="router.svg", mime="image/svg+xml")
        self.assertEqual(status, 201, body)
        self.assertEqual(body["file"], "router.svg")
        ok_ref = SVG_OK.replace(b"<rect", b'<defs><linearGradient id="g"/></defs><rect fill="url(#g)"')
        status, body, _ = self.upload(ok_ref, filename="grad.svg", mime="image/svg+xml")
        self.assertEqual(status, 201, body)

    def test_04_filename_cannot_escape_the_user_folder(self):
        status, body, _ = self.upload(PNG, filename="../../evil.png")
        self.assertEqual(status, 201)
        self.assertEqual(body["file"], "evil.png")
        self.assertFalse((self.tmp / "evil.png").exists())
        self.assertTrue((self.user / "evil.png").exists())

    # ---- rejected input ----
    def test_10_unsafe_svgs_are_rejected(self):
        bad = {
            "script": b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            "handler": b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
            "javascript": b'<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
            "external href": b'<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil.example/x.png"/></svg>',
            "foreignObject": b'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
            "external url()": b'<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(http://evil.example/x)"/></svg>',
            "entity": b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>',
        }
        for label, raw in bad.items():
            with self.subTest(label):
                status, body, _ = self.upload(raw, filename=f"bad-{label[:4]}.svg", mime="image/svg+xml")
                self.assertEqual(status, 400, body)
        self.assertFalse(list(self.user.glob("bad-*")))

    def test_11_content_must_really_be_an_image(self):
        status, body, _ = self.upload(b"just some text, not an image", filename="fake.png")
        self.assertEqual(status, 400, body)
        status, body, _ = self.upload(b"<html><script>alert(1)</script></html>", filename="page.svg", mime="image/svg+xml")
        self.assertEqual(status, 400, body)

    def test_12_size_limits(self):
        status, _, _ = self.upload(PNG + b"\0" * (2 * 1024 * 1024 + 1), filename="big.png")
        self.assertEqual(status, 413)
        status, _, _ = self.call("POST", "/api/icons", b"x" * (5 * 1024 * 1024))
        self.assertEqual(status, 413)

    def test_13_malformed_requests(self):
        self.assertEqual(self.call("POST", "/api/icons", b"not json")[0], 400)
        self.assertEqual(self.call("POST", "/api/icons", {"image": "nope"})[0], 400)
        self.assertEqual(self.call("POST", "/api/icons", {"image": "data:image/png;base64,@@@@"})[0], 400)
        self.assertEqual(self.call("POST", "/api/other", {})[0], 404)

    # ---- who may call it ----
    def test_20_other_websites_cannot_upload(self):
        status, _, _ = self.upload(PNG, filename="x1.png", headers={"Origin": "http://evil.example"})
        self.assertEqual(status, 403)
        status, _, _ = self.upload(PNG, filename="x2.png", headers={"Host": "evil.example"})
        self.assertEqual(status, 403)
        status, _, _ = self.call("DELETE", "/api/icons/my-icon.png", headers={"Origin": "http://evil.example"})
        self.assertEqual(status, 403)
        self.assertFalse(list(self.user.glob("x[12].png")))

    # ---- delete ----
    def test_30_delete_only_removes_listed_user_icons(self):
        self.upload(PNG, filename="gone.png")
        self.assertTrue((self.user / "gone.png").exists())
        status, body, _ = self.call("DELETE", "/api/icons/gone.png")
        self.assertEqual(status, 200, body)
        self.assertFalse((self.user / "gone.png").exists())
        self.assertNotIn("gone.png", [e["file"] for e in self.manifest()])
        # not in the manifest / outside icons/user: refused, and nothing is deleted
        self.assertEqual(self.call("DELETE", "/api/icons/gone.png")[0], 404)
        self.assertEqual(self.call("DELETE", "/api/icons/index.html")[0], 404)
        self.assertEqual(self.call("DELETE", "/api/icons/..%2Frun.py")[0], 404)
        self.assertEqual(self.call("DELETE", "/api/icons/manifest.json")[0], 404)
        self.assertTrue((self.tmp / "index.html").exists())
        self.assertTrue((self.tmp / "run.py").exists())
        self.assertTrue((self.user / "manifest.json").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
