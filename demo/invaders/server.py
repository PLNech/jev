#!/usr/bin/env python3
"""Static server + reverse proxy for the jev Space Invaders demo.

Serves ./ on :8099 and forwards /v1/* to the jev server on :8017
(needed because jev sends no CORS headers).
"""
import sys
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

JEV = "http://127.0.0.1:8017"
JEV_GPU = "http://127.0.0.1:8153"
ROOT = Path(__file__).parent
HOP = {"connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_POST(self):
        if self.path.startswith("/v1/gpu"):
            target, path = JEV_GPU, "/v1" + self.path[len("/v1/gpu"):]
        elif self.path.startswith("/v1/"):
            target, path = JEV, self.path
        else:
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        req = urllib.request.Request(
            target + path, data=body,
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                payload, st, timing = r.read(), r.status, r.headers.get("Server-Timing", "")
        except Exception as e:
            self.send_error(502, str(e))
            return
        self.send_response(st)
        self.send_header("Content-Type", "application/json")
        self.send_header("Server-Timing", timing)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
    print(f"jev-invaders demo on http://127.0.0.1:{port} (proxying /v1 -> {JEV})")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
