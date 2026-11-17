#!/usr/bin/env python3
"""Asks a running Space container the page's own sorting question about the made-up notes in tests/space/notes.csv.

    python3 scripts/check-space.py http://localhost:7860

Reads the problems, reasons, wording and Kev's cut-off from the page, so the question matches what the page sends.
Prints each answer, then how many were right and what the page would show at its cut-off. Fails if the server
does not answer or fewer than MIN_RIGHT notes come back right. Standard library only.
"""
import csv, json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:7860").rstrip("/")
MIN_RIGHT = 40  # Kev-0.8B got 44 of the 54 when this wording was chosen
NOTES = list(csv.DictReader(open(os.path.join(ROOT, "tests", "space", "notes.csv"), encoding="utf-8")))
NONE = "None of these"

html = open(os.path.join(ROOT, "docs", "prototype", "filing_tracker.html"), encoding="utf-8").read()
names = {"REPEATED": "Missing repeated-conduct facts", "NONE_OF_THESE": NONE}
block = re.search(r"var REASONS = \[\n(.*?)\n  \];", html, re.S).group(1)
reasons = {names.get(t) or json.loads(t): r for t, r in re.findall(r'^\s*\[(REPEATED|NONE_OF_THESE|"[^"]+"), "([^"]+)"\],?\s*$', block, re.M)}
criteria = {t: r[0].upper() + r[1:] + "." for t, r in reasons.items()}
instructions = re.search(r'instructions: "(.*?)", criteria', html).group(1)
cut = float(re.search(r"MIN_CONFIDENCE = kev \? ([\d.]+)", html).group(1))
print(f"{len(NOTES)} notes, {len(criteria)} problems, cut-off {cut}")

with urllib.request.urlopen(URL + "/v1/version", timeout=10) as r:
    print("version:", r.read().decode())
right = shown_right = shown_wrong = 0
times = []
for n in NOTES:
    body = {"model": "kev-latest", "state": {"case_type": n["case_type"], "form": n["form"] or "not given", "clerk_note": n["clerk_note"]},
            "questions": {"problem": {"type": "choice", "instructions": instructions, "criteria": criteria}}}
    req = urllib.request.Request(URL + "/v1/systemone", json.dumps(body).encode(), {"Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=120) as r:
        p = json.load(r)["answers"]["problem"]["probabilities"]
    times.append((time.perf_counter() - t0) * 1000)
    top = max(criteria, key=lambda t: p.get(t, 0))
    conf = max(0, (p.get(top, 0) - 1 / len(criteria)) / (1 - 1 / len(criteria)))
    ok = top == n["expected"]
    right += ok
    if conf >= cut and top != NONE:
        shown_right += ok
        shown_wrong += not ok
    print(f"{times[-1]:6.0f} ms  {'right' if ok else 'WRONG'}  {top} ({conf:.2f})  <- {n['clerk_note']!r}, expected {n['expected']}")
print(f"\n{right} of {len(NOTES)} right; at the cut-off the page suggests {shown_right} right and {shown_wrong} wrong, "
      f"and says not sure for {len(NOTES) - shown_right - shown_wrong}; {sum(times) / len(times):.0f} ms a note on average")
if right < MIN_RIGHT:
    sys.exit(f"fewer than {MIN_RIGHT} right")
