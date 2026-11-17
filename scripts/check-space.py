#!/usr/bin/env python3
"""TEMPORARY experiment: compares ways of asking Kev the page's sorting question on 24 made-up notes.

    python3 scripts/check-space.py http://localhost:7860

Standard library only. Each variant is one question; Kev answers questions independently, so up to four
variants share one request.
"""
import json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:7860").rstrip("/")
PO, SC, NC, EV, DV = "Protective order", "Small claims", "Name change", "Eviction", "Divorce"
REP, DET, SIG, FORM, CTY = "Missing repeated-conduct facts", "Missing required details", "Missing signature", "Wrong form", "Wrong county or court"
FEE, CIT, ADDR, VER, PAGE, NONE = "Missing fee or fee waiver", "Citation not found or wrong", "Missing addresses for service", "Not verified or notarized", "Pages missing or unreadable", "None of these"
NOTES = [(PO, "petition only talks about being followed home last week", REP),
         (PO, "only one incident described, stalking needs more than one", REP),
         (PO, "narrative covers a single phone call, no pattern", REP),
         (PO, "left the what happened section empty", DET),
         (SC, "no amount claimed on the complaint", DET),
         (EV, "dates of nonpayment not filled in", DET),
         (SC, "not signed on page 2", SIG),
         (NC, "petitioner forgot to sign", SIG),
         (SC, "used the 2019 version of the form", FORM),
         (DV, "wrong form for a dissolution with kids", FORM),
         (SC, "defendant lives in Lake, should be filed there", CTY),
         (PO, "belongs in circuit court not this one", CTY),
         (NC, "came without the 157 dollars", FEE),
         (SC, "no filing fee and no fee waiver attached", FEE),
         (EV, "cites IC 32-31-99 which does not exist", CIT),
         (SC, "case cited in the brief could not be found", CIT),
         (SC, "we have nowhere to send the papers to the other side", ADDR),
         (PO, "respondent address blank", ADDR),
         (PO, "needs the under penalties for perjury line", VER),
         (NC, "not notarized", VER),
         (DV, "page 3 missing from the upload", PAGE),
         (SC, "scan is blurry, cannot read it", PAGE),
         (SC, "see clerk", NONE),
         (PO, "called petitioner, will refile", NONE)]

html = open(os.path.join(ROOT, "docs", "prototype", "filing_tracker.html"), encoding="utf-8").read()
names = {"REPEATED": REP, "NONE_OF_THESE": NONE}
help_ = json.loads("{" + re.search(r"var TAG_HELP = \{(.*?)\n  \};", html, re.S).group(1) + "}")
help_[NONE] = "No problem on the list fits the note."
block = re.search(r"var REASONS = \[\n(.*?)\n  \];", html, re.S).group(1)
reasons = [(names.get(t) or json.loads(t), r) for t, r in re.findall(r'^\s*\[(REPEATED|NONE_OF_THESE|"[^"]+"), "([^"]+)"\],?\s*$', block, re.M)]
tags = list(dict.fromkeys(t for t, _ in reasons))
OLD = re.search(r'instructions: "(.*?)", criteria', html).group(1)
NEW = "A court clerk sent this filing back and typed a short note saying why. Which problem on the list does the note describe?"
pairs = {f"{t}, because {r}": help_[t] for t, r in reasons}
said = {t: "; or ".join(r[0].upper() + r[1:] for tt, r in reasons if tt == t) + "." for t in tags}
VARIANTS = {
    "A  pairs+help, old words, sum": (OLD, pairs, "sum"),
    "A2 pairs+help, new words, sum": (NEW, pairs, "sum"),
    "B  tags+help, new words": (NEW, {t: help_[t] for t in tags}, "tag"),
    "B2 tags+help, old words": (OLD, {t: help_[t] for t in tags}, "tag"),
    "C  tags+note-says, new words": (NEW, {t: said[t] for t in tags}, "tag"),
    "D  tags only, new words": (NEW, {t: None for t in tags}, "tag"),
    "E  tags+help+note-says, new": (NEW, {t: help_[t] + " " + said[t] for t in tags}, "tag"),
}
print(f"{len(reasons)} reasons, {len(tags)} problems from the page")
with urllib.request.urlopen(URL + "/v1/version", timeout=10) as r:
    print("version:", r.read().decode())


def ask(state, qs):
    body = {"model": "kev-latest", "state": state, "questions": qs}
    req = urllib.request.Request(URL + "/v1/systemone", json.dumps(body).encode(), {"Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=120) as r:
        a = json.load(r)["answers"]
    return a, (time.perf_counter() - t0) * 1000


def pick(mode, crit, a):
    p = a["probabilities"]
    if mode == "tag":
        by = {k: p.get(k, 0) for k in crit}
    else:
        by = {}
        for (t, _), k in zip(reasons, crit):
            by[t] = by.get(t, 0) + p.get(k, 0)
    top = max(by, key=by.get)
    u = 1 / len(by)
    return top, max(0, (by[top] - u) / (1 - u))


score = {v: [0, [], []] for v in VARIANTS}
score["A3 pairs, old words, argmax"] = [0, [], []]
times, single = [], []
names_ = list(VARIANTS)
for case_type, note, expected in NOTES:
    state = {"case_type": case_type, "form": "not given", "clerk_note": note}
    line = []
    for chunk in (names_[:4], names_[4:]):
        qs = {f"q{i}": {"type": "choice", "instructions": VARIANTS[v][0], "criteria": VARIANTS[v][1]} for i, v in enumerate(chunk)}
        a, ms = ask(state, qs)
        times.append((len(chunk), ms))
        for i, v in enumerate(chunk):
            top, conf = pick(VARIANTS[v][2], VARIANTS[v][1], a[f"q{i}"])
            s = score[v]; s[0] += top == expected; (s[1] if top == expected else s[2]).append(conf)
            line.append(f"{v[:2].strip()}:{'ok' if top == expected else top[:14]}")
            if v.startswith("A "):
                best = max(a[f"q{i}"]["probabilities"], key=a[f"q{i}"]["probabilities"].get).split(", because")[0]
                s = score["A3 pairs, old words, argmax"]; s[0] += best == expected; (s[1] if best == expected else s[2]).append(0)
                line.append(f"A3:{'ok' if best == expected else best[:14]}")
    _, ms1 = ask(state, {"q": {"type": "choice", "instructions": NEW, "criteria": {t: help_[t] for t in tags}}})
    single.append(ms1)
    print(f"{expected[:22]:22} <- {note[:44]:44} " + " ".join(line), flush=True)

print()
for v, (right, ok, bad) in score.items():
    m = lambda xs: sum(xs) / len(xs) if xs else 0
    print(f"{v:32} {right:2d}/{len(NOTES)}  conf when right {m(ok):.2f}, when wrong {m(bad):.2f}")
for n in (4, 3):
    xs = [ms for k, ms in times if k == n]
    print(f"{n} questions per request: {sum(xs) / len(xs):.0f} ms on average")
print(f"1 question per request: {sum(single) / len(single):.0f} ms on average")
