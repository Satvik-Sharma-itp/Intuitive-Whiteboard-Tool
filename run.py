"""Serve the whiteboard on localhost and open it in the default browser.

Usage:  python run.py [--port 8000] [--no-browser]

Uses only the Python standard library (no pip install needed).

Besides the static files it exposes a tiny API so users can add their own device icons:
  POST   /api/icons          save an uploaded icon into icons/user/ and list it in icons/user/manifest.json
  DELETE /api/icons/<file>   remove a user icon again
The server only listens on 127.0.0.1 and rejects requests that did not come from its own pages.
"""
import argparse
import base64
import binascii
import functools
import http.server
import json
import os
import re
import socketserver
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
USER_ICONS = ROOT / "icons" / "user"
USER_MANIFEST = USER_ICONS / "manifest.json"

MAX_BODY = 4 * 1024 * 1024        # upload request (base64 inflates the file by ~1/3)
MAX_ICON = 2 * 1024 * 1024        # decoded icon file
MAX_DRAIN = 16 * 1024 * 1024      # how much of an oversized body we swallow so the client sees the 413
EXT = {"png": "png", "jpg": "jpg", "gif": "gif", "webp": "webp", "svg": "svg"}
MANIFEST_LOCK = threading.Lock()


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def sniff(data):
    """Identify an image by its content (the declared type is never trusted)."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    head = data[:4096].lstrip(b"\xef\xbb\xbf").lstrip().lower()
    if head.startswith(b"<") and b"<svg" in head:
        return "svg"
    return None


UNSAFE_SVG = [
    (re.compile(r"<\s*script", re.I), "scripts"),
    (re.compile(r"<\s*(foreignObject|iframe|embed|object|audio|video|animate|set)\b", re.I), "embedded or animated content"),
    (re.compile(r"\bon[a-z]+\s*=", re.I), "event handlers"),
    (re.compile(r"javascript\s*:", re.I), "javascript: links"),
    (re.compile(r"<!\s*(ENTITY|DOCTYPE[^>]*\[)", re.I), "entity declarations"),
    (re.compile(r"@import", re.I), "@import"),
    (re.compile(r"""url\(\s*['"]?\s*(?!#|data:image/)""", re.I), "external url() references"),
    (re.compile(r"""\bhref\s*=\s*['"]\s*(?!#|data:image/)""", re.I), "external links"),
]


def check_svg(data):
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ApiError(400, "SVG files must be UTF-8 text")
    for rx, what in UNSAFE_SVG:
        if rx.search(text):
            raise ApiError(400, f"this SVG contains {what}, which is not allowed in an icon")


def clean_name(value, fallback):
    name = re.sub(r"[\x00-\x1f\x7f<>]", "", str(value or "")).strip()[:60]
    return name or fallback


def safe_stem(value):
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "")).strip("-.")[:60]
    return stem or "icon"


def read_manifest():
    try:
        data = json.loads(USER_MANIFEST.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def write_manifest(entries):
    tmp = USER_MANIFEST.with_suffix(".tmp")
    tmp.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, USER_MANIFEST)


def add_icon(req):
    if not isinstance(req, dict):
        raise ApiError(400, "request body must be a JSON object")
    url = req.get("image")
    if not isinstance(url, str) or not url.startswith("data:") or "," not in url:
        raise ApiError(400, "image must be a data URL")
    try:
        data = base64.b64decode("".join(url.split(",", 1)[1].split()), validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(400, "image is not valid base64")
    if not data:
        raise ApiError(400, "the file is empty")
    if len(data) > MAX_ICON:
        raise ApiError(413, f"icons can be at most {MAX_ICON // (1024 * 1024)} MB")
    kind = sniff(data)
    if kind is None:
        raise ApiError(400, "unsupported file; use PNG, SVG, JPG, GIF or WebP")
    if kind == "svg":
        check_svg(data)

    original = str(req.get("filename") or "")
    stem = safe_stem(Path(original).stem if original else req.get("name"))
    name = clean_name(req.get("name"), stem)
    with MANIFEST_LOCK:
        USER_ICONS.mkdir(parents=True, exist_ok=True)
        filename, n = f"{stem}.{EXT[kind]}", 2
        while (USER_ICONS / filename).exists():
            filename, n = f"{stem}-{n}.{EXT[kind]}", n + 1
        tmp = USER_ICONS / (filename + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, USER_ICONS / filename)
        entries = read_manifest()
        entries.append({"name": name, "file": filename})
        write_manifest(entries)
    return {"name": name, "file": filename}


def delete_icon(filename):
    with MANIFEST_LOCK:
        entries = read_manifest()
        # only files that are listed in our manifest can be deleted, so a crafted path can never escape icons/user
        if not any(e.get("file") == filename for e in entries if isinstance(e, dict)):
            raise ApiError(404, "no such user icon")
        path = USER_ICONS / filename
        if path.parent.resolve() != USER_ICONS.resolve():
            raise ApiError(400, "bad file name")
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        write_manifest([e for e in entries if not (isinstance(e, dict) and e.get("file") == filename)])
    return {"ok": True}


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Always serve fresh files while developing.
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if self.path.split("?", 1)[0].startswith("/icons/"):
            # uploaded SVGs must never run anything if someone opens them directly
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the console quiet

    # ---- small JSON API -------------------------------------------------
    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _same_origin(self):
        port = self.server.server_address[1]
        host = (self.headers.get("Host") or "").lower()
        if host not in (f"localhost:{port}", f"127.0.0.1:{port}"):
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin.lower() == f"http://{host}"

    def _api(self, work):
        try:
            if not self._same_origin():
                raise ApiError(403, "requests must come from the whiteboard page itself")
            self._json(*work())
        except ApiError as e:
            self._json(e.status, {"error": e.message})
        except Exception as e:  # never leak a traceback to the client
            self._json(500, {"error": f"server error: {type(e).__name__}"})

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ApiError(400, "bad Content-Length")
        if length > MAX_BODY:
            left = min(length, MAX_DRAIN)  # read and discard so the browser reliably receives the 413
            while left > 0:
                chunk = self.rfile.read(min(65536, left))
                if not chunk:
                    break
                left -= len(chunk)
            self.close_connection = True
            raise ApiError(413, "that file is too large")
        return self.rfile.read(length)

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/icons":
            return self._json(404, {"error": "not found"})

        def work():
            try:
                req = json.loads(self._read_body().decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                raise ApiError(400, "request body is not valid JSON")
            return 201, add_icon(req)
        self._api(work)

    def do_DELETE(self):
        m = re.fullmatch(r"/api/icons/([A-Za-z0-9._-]{1,80})", self.path.split("?", 1)[0])
        if not m:
            return self._json(404, {"error": "not found"})
        self._api(lambda: (200, delete_icon(m.group(1))))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    args = parser.parse_args()

    handler = functools.partial(Handler, directory=str(ROOT))
    server = None
    port = args.port
    # If the port is busy, try the next few.
    for p in range(port, port + 10):
        try:
            server = Server(("127.0.0.1", p), handler)
            port = p
            break
        except OSError:
            continue
    if server is None:
        raise SystemExit(f"Could not find a free port starting at {args.port}.")

    url = f"http://localhost:{port}/index.html"
    print(f"Whiteboard running at {url}\nPress Ctrl+C to stop.")
    if port != args.port:
        print(f"(port {args.port} was busy; boards are saved per address, so this is a different saved board)")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
