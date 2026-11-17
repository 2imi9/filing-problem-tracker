#!/usr/bin/env python3
"""TEMPORARY experiment, round 2: compares ways of asking Kev on tests/space/notes.csv, one question per request.

    python3 scripts/check-space.py http://localhost:7860
"""
import csv, json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:7860").rstrip("/")
NOTES = list(csv.DictReader(open(os.path.join(ROOT, "tests", "space", "notes.csv"), encoding="utf-8")))
REP, NONE = "Missing repeated-conduct facts", "None of these"

html = open(os.path.join(ROOT, "docs", "prototype", "filing_tracker.html"), encoding="utf-8").read()
names = {"REPEATED": REP, "NONE_OF_THESE": NONE}
help_ = json.loads("{" + re.search(r"var TAG_HELP = \{(.*?)\n  \};", html, re.S).group(1) + "}")
help_[NONE] = "No problem on the list fits the note."
block = re.search(r"var REASONS = \[\n(.*?)\n  \];", html, re.S).group(1)
reasons = [(names.get(t) or json.loads(t), r) for t, r in re.findall(r'^\s*\[(REPEATED|NONE_OF_THESE|"[^"]+"), "([^"]+)"\],?\s*$', block, re.M)]
tags = list(dict.fromkeys(t for t, _ in reasons))
OLD = re.search(r'instructions: "(.*?)", criteria', html).group(1)
NEW = "A court clerk sent this filing back and typed a short note saying why. Which problem on the list does the note describe?"
said = {t: "; or ".join(r[0].upper() + r[1:] for tt, r in reasons if tt == t) + "." for t in tags}
ONE = {REP: "the note says the petition describes only one incident, not repeated conduct",
       "Missing required details": "the note says dates, an amount, a description or another required fact is missing",
       "Missing signature": "the note says the filing or a page is not signed",
       "Wrong form": "the note says the wrong form or an old version was used",
       "Wrong county or court": "the note says it belongs in another county or court",
       "Missing fee or fee waiver": "the note says the fee was not paid and no waiver was filed",
       "Citation not found or wrong": "the note says a cited case or statute does not exist or is wrong",
       "Missing addresses for service": "the note says an address for the other party is missing",
       "Not verified or notarized": "the note says it was not sworn, verified or notarized",
       "Pages missing or unreadable": "the note says pages are missing, blank or unreadable",
       NONE: "the note does not say what was wrong with the filing"}
assert set(ONE) == set(tags), set(tags) ^ set(ONE)
cap = lambda s: s[0].upper() + s[1:] + "."
pair_keys = [f"{t}, because {r}" for t, r in reasons]
VARIANTS = {  # name: (instructions, criteria, key -> tag)
    "A3 pairs+help, old, argmax": (OLD, {k: help_[t] for k, (t, _) in zip(pair_keys, reasons)}, dict(zip(pair_keys, [t for t, _ in reasons]))),
    "F  pairs only, old, argmax": (OLD, {k: None for k in pair_keys}, dict(zip(pair_keys, [t for t, _ in reasons]))),
    "C  tags+note-says joined, new": (NEW, {t: said[t] for t in tags}, {t: t for t in tags}),
    "C1 tags+one reason, new": (NEW, {t: cap(ONE[t]) for t in tags}, {t: t for t in tags}),
    "C1o tags+one reason, old": (OLD, {t: cap(ONE[t]) for t in tags}, {t: t for t in tags}),
    "G  reason sentences only, new": (NEW, {cap(ONE[t]): None for t in tags}, {cap(ONE[t]): t for t in tags}),
}
print(f"{len(NOTES)} notes; {len(reasons)} reasons, {len(tags)} problems from the page")
with urllib.request.urlopen(URL + "/v1/version", timeout=10) as r:
    print("version:", r.read().decode())


def ask(state, q):
    body = {"model": "kev-latest", "state": state, "questions": {"problem": q}}
    req = urllib.request.Request(URL + "/v1/systemone", json.dumps(body).encode(), {"Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=120) as r:
        a = json.load(r)["answers"]["problem"]
    return a, (time.perf_counter() - t0) * 1000


res = {v: [] for v in VARIANTS}  # (expected, top, conf)
ms_ = {v: [] for v in VARIANTS}
for n in NOTES:
    state = {"case_type": n["case_type"], "form": n["form"] or "not given", "clerk_note": n["clerk_note"]}
    line = []
    for v, (instr, crit, to_tag) in VARIANTS.items():
        a, ms = ask(state, {"type": "choice", "instructions": instr, "criteria": crit})
        p = a["probabilities"]
        k = max(crit, key=lambda x: p.get(x, 0))
        u = 1 / len(crit)
        conf = max(0, (p.get(k, 0) - u) / (1 - u))
        top = to_tag[k]
        res[v].append((n["expected"], top, conf)); ms_[v].append(ms)
        line.append(f"{v.split()[0]}:{'ok' if top == n['expected'] else top[:12]}({conf:.2f})")
    print(f"{n['expected'][:20]:20} <- {n['clerk_note'][:40]:40} " + " ".join(line), flush=True)

print()
print("variant                          right  ms   | at cut-off t: suggested right / suggested wrong / not sure")
for v, rows in res.items():
    right = sum(e == t for e, t, _ in rows)
    cuts = []
    for t in (0.1, 0.15, 0.2, 0.25, 0.3):
        ok = sum(1 for e, top, c in rows if c >= t and top == e and top != NONE)
        bad = sum(1 for e, top, c in rows if c >= t and top != e and top != NONE)
        cuts.append(f"t={t}: {ok}/{bad}/{len(rows) - ok - bad}")
    print(f"{v:32} {right:2d}/{len(rows)} {sum(ms_[v]) / len(ms_[v]):5.0f} | " + "  ".join(cuts))
