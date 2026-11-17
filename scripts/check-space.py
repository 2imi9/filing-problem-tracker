#!/usr/bin/env python3
"""Asks a running Space container the page's own sorting question about a few made-up notes.

    python3 scripts/check-space.py http://localhost:7860

Reads the problem list, reasons and descriptions from the page, so the question matches what the page sends.
Prints each answer and how long it took; fails only if the server does not answer. Standard library only.
"""
import json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:7860").rstrip("/")
NOTES = [("Protective order", "petition only talks about being followed home last week", "Missing repeated-conduct facts"),
         ("Protective order", "left the what happened section empty", "Missing required details"),
         ("Protective order", "needs the under penalties for perjury line", "Not verified or notarized"),
         ("Small claims", "we have nowhere to send the papers to the other side", "Missing addresses for service"),
         ("Name change", "came without the 157 dollars", "Missing fee or fee waiver"),
         ("Small claims", "see clerk", "None of these")]

html = open(os.path.join(ROOT, "docs", "prototype", "filing_tracker.html"), encoding="utf-8").read()
names = {"REPEATED": "Missing repeated-conduct facts", "NONE_OF_THESE": "None of these"}
help_ = json.loads("{" + re.search(r"var TAG_HELP = \{(.*?)\n  \};", html, re.S).group(1) + "}")
block = re.search(r"var REASONS = \[\n(.*?)\n  \];", html, re.S).group(1)
reasons = [(names.get(t) or json.loads(t), r) for t, r in re.findall(r'^\s*\[(REPEATED|NONE_OF_THESE|"[^"]+"), "([^"]+)"\],?\s*$', block, re.M)]
instructions = re.search(r'instructions: "(.*?)", criteria', html).group(1)
criteria = {f"{t}, because {r}": help_.get(t, "No problem on the list fits the note.") for t, r in reasons}
print(f"{len(reasons)} options from the page")

with urllib.request.urlopen(URL + "/v1/version", timeout=10) as r:
    print("version:", r.read().decode())
right = 0
for case_type, note, expected in NOTES:
    body = {"model": "kev-latest", "state": {"case_type": case_type, "form": "not given", "clerk_note": note},
            "questions": {"problem": {"type": "choice", "instructions": instructions, "criteria": criteria}}}
    t0 = time.perf_counter()
    req = urllib.request.Request(URL + "/v1/systemone", json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        a = json.load(r)["answers"]["problem"]
    ms = (time.perf_counter() - t0) * 1000
    by_tag = {}
    for (t, _), k in zip(reasons, criteria):
        by_tag[t] = by_tag.get(t, 0) + a["probabilities"].get(k, 0)
    top = max(by_tag, key=by_tag.get)
    u = 1 / len(by_tag)
    conf = max(0, (by_tag[top] - u) / (1 - u))
    right += top == expected
    print(f"{ms:6.0f} ms  {'right' if top == expected else 'WRONG'}  {top} ({conf:.2f})  <- {note!r}, expected {expected}")
print(f"{right} of {len(NOTES)} right")
