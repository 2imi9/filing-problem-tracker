#!/usr/bin/env python3
"""Serves the prototype on this computer and passes /v1/* to a local Kev server.

The page and the model then share one address, so the browser needs no special
permission and nothing leaves the machine. Standard library only.

    sh scripts/start-kev.sh          # terminal 1: Kev-0.8B, on 127.0.0.1:8009
    python3 scripts/serve-local.py   # terminal 2: the site, on http://localhost:8080

OpenJev (scripts/start-openjev.sh) works too: --model-url http://127.0.0.1:3000
"""
import argparse, json, os, subprocess, urllib.error, urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROUTES = {("GET", "/v1/version"), ("POST", "/v1/systemone")}
MAX_BODY = 1_000_000  # one row per request is a few hundred bytes


class Handler(SimpleHTTPRequestHandler):
    model_url = ""

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def reply(self, code, data, kind="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def version(self):
        """Which model is running. Kev has no /v1/version, so the answer comes from its /v1/models card."""
        for path in ("/v1/version", "/v1/models"):
            try:
                with urllib.request.urlopen(self.model_url + path, timeout=5) as response:
                    found = json.load(response)
                if path == "/v1/models":
                    card = found["models"][0]
                    found = {"model": card.get("run") or card.get("name"), "backend": card.get("backend"), "server": "kev"}
                else:
                    found.setdefault("model", found.get("model_dir") or "openjev")  # OpenJev's helper names its folder only
                return self.reply(200, json.dumps(found).encode())
            except urllib.error.HTTPError as error:
                if error.code != 404: break
            except (OSError, ValueError, KeyError, IndexError, TypeError, AttributeError):
                break
        self.reply(503, json.dumps({"error": "local model is not running"}).encode())

    def forward(self, method):
        path = self.path.split("?")[0].rstrip("/")
        if (method, path) == ("GET", "/v1/version"):
            return self.version()
        if (method, path) not in ROUTES:
            return self.reply(404, b'{"error":"not found"}')
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self.reply(413, b'{"error":"request too large"}')
        body = self.rfile.read(length) if method == "POST" else None
        request = urllib.request.Request(self.model_url + path, data=body, method=method,
                                         headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                self.reply(response.status, response.read())
        except urllib.error.HTTPError as error:
            self.reply(error.code, error.read())
        except OSError:
            self.reply(502, json.dumps({"error": "local model is not running"}).encode())

    def do_GET(self):
        if self.path.startswith("/v1/"):
            return self.forward("GET")
        super().do_GET()

    def do_POST(self):
        self.forward("POST")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--model-url", default=os.environ.get("MODEL_URL", "http://127.0.0.1:8009"),
                        help="the model server (default Kev on 127.0.0.1:8009; OpenJev is http://127.0.0.1:3000)")
    args = parser.parse_args()
    subprocess.run(["sh", "scripts/build-site.sh"], cwd=ROOT, check=True)
    Handler.model_url = args.model_url.rstrip("/")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=os.path.join(ROOT, "site")))
    print(f"Tracker on http://localhost:{args.port}  (local model expected at {Handler.model_url})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
