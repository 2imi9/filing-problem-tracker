#!/usr/bin/env python3
"""One small server for a Hugging Face Space: the tracker page and the Kev-0.8B sorting model at one address.

It serves the static page, starts Kev (https://github.com/jaredpalmer/kev, Apache-2.0) on 127.0.0.1:8009,
and passes POST /v1/systemone to it after checking the request is a small choice question. GET /v1/version
names the model once Kev is up. Kev only picks from a list, so there is no /v1/explain here and the page
skips its thinking step. Standard library only.
"""
import json, os, subprocess, sys, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "7860"))
RUN = os.environ.get("KEV_RUN", "jaredpalmer/kev-0.8b@v1.0")
KEV = os.environ.get("KEV_URL", "http://127.0.0.1:8009")
STATIC = {"/": ("index.html", "text/html; charset=utf-8"), "/index.html": ("index.html", "text/html; charset=utf-8"),
          "/courthouse-ascii-hero.jpg": ("courthouse-ascii-hero.jpg", "image/jpeg"), "/mark.svg": ("mark.svg", "image/svg+xml")}
MAX_BODY, MAX_STATE, MAX_OPTIONS, MAX_QUESTIONS = 20_000, 4_000, 26, 4


class BadRequest(ValueError):
    pass


def start_model():
    if os.environ.get("KEV_URL"):
        return  # a model server is already running somewhere else (tests)
    subprocess.Popen([sys.executable, "-m", "kev.serve", "--run", RUN, "--host", "127.0.0.1", "--port", "8009"])


def model_card():
    """Kev's /v1/models card once the model has loaded, else None."""
    try:
        with urllib.request.urlopen(KEV + "/v1/models", timeout=3) as r:
            return json.load(r)["models"][0]
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        return None


def check(body):
    """Only small choice questions go to the model, the kind the page asks."""
    state, questions = body.get("state"), body.get("questions")
    if state is None or not isinstance(questions, dict) or not 1 <= len(questions) <= MAX_QUESTIONS:
        raise BadRequest("state and one to four questions are required")
    state_text = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)
    if len(state_text) > MAX_STATE:
        raise BadRequest("state is too long")
    for q in questions.values():
        if not isinstance(q, dict) or q.get("type") != "choice":
            raise BadRequest("this server answers choice questions only")
        if not isinstance(q.get("criteria"), dict) or not 2 <= len(q["criteria"]) <= MAX_OPTIONS:
            raise BadRequest("a choice needs 2 to 26 options")
    return {"model": "kev-latest", "state": state, "questions": questions}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def reply(self, code, data, kind="application/json"):
        if not isinstance(data, bytes):
            data = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path.rstrip("/") == "/v1/version":
            card = model_card()
            if card:
                return self.reply(200, {"model": card.get("run") or RUN, "backend": card.get("backend"), "server": "space/server.py"})
            return self.reply(503, {"error": "the model is still loading", "model": RUN})
        if path in STATIC:
            name, kind = STATIC[path]
            with open(os.path.join(HERE, name), "rb") as f:
                return self.reply(200, f.read(), kind)
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        if self.path.split("?")[0].rstrip("/") != "/v1/systemone":
            return self.reply(404, {"error": "not found"})
        if length > MAX_BODY:
            return self.reply(413, {"error": "request too large"})
        try:
            body = check(json.loads(self.rfile.read(length) or b"{}"))
        except (BadRequest, json.JSONDecodeError, AttributeError) as error:
            return self.reply(422, {"error": str(error)})
        request = urllib.request.Request(KEV + "/v1/systemone", data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=110) as r:
                return self.reply(200, r.read())
        except urllib.error.HTTPError as error:
            return self.reply(error.code if error.code in (422, 503) else 502, {"error": "the model did not answer"})
        except OSError:
            return self.reply(502, {"error": "the model did not answer"})


if __name__ == "__main__":
    start_model()
    print(f"Tracker and Kev on port {PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
