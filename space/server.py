#!/usr/bin/env python3
"""One small server for a Hugging Face Space: the tracker page and the sorting model at one address.

It serves the static page, starts llama.cpp with OpenJev Flash 9B, and answers
POST /v1/systemone for Choice questions the way the OpenJev helper does: state,
question and lettered options go in, the scores of the option letters at the
first output position come out as probabilities. Standard library only.
"""
import json, math, os, shutil, subprocess, threading, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "7860"))
MODEL = os.environ.get("MODEL_FILE", "/models/openjev-flash-9b-q4.gguf")
LLAMA = os.environ.get("LLAMA_URL", "http://127.0.0.1:8080")
TEMP = 1.07  # OpenJev Flash 9B's published calibration for Choice answers
FLOOR = -30.0  # score for an option letter the model ranked too low to be reported
LETTERS = [chr(65 + i) for i in range(26)]
STATIC = {"/": ("index.html", "text/html; charset=utf-8"), "/index.html": ("index.html", "text/html; charset=utf-8"),
          "/courthouse-ascii-hero.jpg": ("courthouse-ascii-hero.jpg", "image/jpeg"), "/mark.svg": ("mark.svg", "image/svg+xml")}
MAX_BODY, MAX_STATE, MAX_OPTIONS, MAX_QUESTIONS = 20_000, 4_000, 26, 4
one_at_a_time = threading.Lock()  # a free Space has two CPU cores; answer one question at a time


class BadRequest(ValueError):
    pass


def start_model():
    if os.environ.get("LLAMA_URL"):
        return  # a model server is already running somewhere else (tests)
    binary = shutil.which("llama-server") or "/app/llama-server"
    subprocess.Popen([binary, "-m", MODEL, "--host", "127.0.0.1", "--port", "8080", "-c", "4096", "-np", "1",
                      "--threads", str(os.cpu_count() or 2), "--jinja", "--reasoning-budget", "0", "--no-webui"])


def model_ready():
    try:
        with urllib.request.urlopen(LLAMA + "/health", timeout=3) as r:
            return r.status == 200
    except OSError:
        return False


def answer_choice(state_text, question):
    criteria = question.get("criteria")
    instructions = question.get("instructions")
    if not isinstance(criteria, dict) or not 2 <= len(criteria) <= MAX_OPTIONS or not isinstance(instructions, str):
        raise BadRequest("a choice needs instructions and 2 to 26 options")
    options = [(str(k), "" if v is None else str(v)) for k, v in criteria.items()]
    lines = "\n".join(f"[{LETTERS[i]}] {k}: {d}" for i, (k, d) in enumerate(options))
    prompt = (f"State:\n{state_text}\n\nQuestion: {instructions}\nOptions:\n{lines}\n\n"
              "Answer with the letter of the best option only.")
    body = {"messages": [{"role": "user", "content": prompt}], "max_tokens": 1, "temperature": 0,
            "logprobs": True, "top_logprobs": 64, "chat_template_kwargs": {"enable_thinking": False}}
    request = urllib.request.Request(LLAMA + "/v1/chat/completions", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
    with one_at_a_time, urllib.request.urlopen(request, timeout=110) as r:
        reply = json.load(r)
    top = reply["choices"][0]["logprobs"]["content"][0]["top_logprobs"]
    scores = {}
    for item in top:  # an exact letter wins over a look-alike such as " A"
        token = item["token"]
        key = token if token in LETTERS else token.strip()
        if key not in scores or token in LETTERS:
            scores[key] = item["logprob"]
    z = [scores.get(LETTERS[i], FLOOR) / TEMP for i in range(len(options))]
    peak = max(z)
    weights = [math.exp(v - peak) for v in z]
    total = sum(weights)
    probs = [w / total for w in weights]
    best = max(range(len(probs)), key=probs.__getitem__)
    uniform = 1.0 / len(probs)
    found = any(LETTERS[i] in scores for i in range(len(options)))
    confidence = max(0.0, (probs[best] - uniform) / (1.0 - uniform)) if found else 0.0
    return {"type": "choice", "choice": options[best][0],
            "probabilities": {k: round(p, 4) for (k, _), p in zip(options, probs)}, "confidence": round(confidence, 4)}


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
            if model_ready():
                return self.reply(200, {"model": os.path.basename(MODEL), "T": TEMP, "server": "space/server.py"})
            return self.reply(503, {"error": "the model is still loading"})
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
            body = json.loads(self.rfile.read(length) or b"{}")
            state, questions = body.get("state"), body.get("questions")
            if state is None or not isinstance(questions, dict) or not 1 <= len(questions) <= MAX_QUESTIONS:
                raise BadRequest("state and one to four questions are required")
            state_text = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)
            if len(state_text) > MAX_STATE:
                raise BadRequest("state is too long")
            if any(not isinstance(q, dict) or q.get("type") != "choice" for q in questions.values()):
                raise BadRequest("this server answers choice questions only")
            answers = {name: answer_choice(state_text, q) for name, q in questions.items()}
        except (BadRequest, json.JSONDecodeError, AttributeError) as error:
            return self.reply(422, {"error": str(error)})
        except (OSError, KeyError, IndexError, TypeError):
            return self.reply(502, {"error": "the model did not answer"})
        self.reply(200, {"model": os.path.basename(MODEL), "answers": answers})


if __name__ == "__main__":
    start_model()
    print(f"Tracker and model on port {PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
