#!/usr/bin/env python3
"""Scores how well Import sorts clerk notes into the problem list.

Runs the made-up notes in tests/tagging/notes.csv, each with its right answer, through the keyword rules and the
model question of docs/prototype/filing_tracker.html. Both are read from that file, so this measures what the page does.

  python3 scripts/score-tagging.py                               # keyword rules only
  python3 scripts/score-tagging.py --url http://127.0.0.1:8009   # the rules, a model, and the two together

--url is any server that answers POST /v1/systemone (Kev, OpenJev, hosted Jev). Standard library only.
"""
import argparse, csv, json, os, re, statistics, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "docs", "prototype", "filing_tracker.html")
NONE = "None of these"


def from_page():
    """The tag list, keyword rules and model question, exactly as the page has them."""
    html = open(PAGE, encoding="utf-8").read()

    def find(pattern, what):
        m = re.search(pattern, html, re.S)
        if not m: sys.exit(f"Could not find {what} in {PAGE}. The page changed; update this script.")
        return m.group(1)

    tags = json.loads(find(r"var TAGS = (\[.*?\]);", "the tag list"))
    rules = [(re.compile(p, re.I), tag) for p, tag in re.findall(r'^\s*\[/(.+)/i, "(.+?)"\],?\s*$', find(r"var RULES = \[\n(.*?)\n  \];", "the keyword rules"), re.M)]
    if not rules: sys.exit("Found no keyword rules in the page.")
    criteria = json.loads("{" + find(r"var TAG_HELP = \{(.*?)\n  \};", "the tag descriptions") + "}")
    criteria[NONE] = find(r'criteria\[NONE_OF_THESE\] = "(.*?)";', "the 'None of these' description")
    question = {"type": "choice", "instructions": find(r'instructions: "(.*?)", criteria', "the model instructions"), "criteria": criteria}
    return tags, rules, question, float(find(r"var MIN_CONFIDENCE = ([\d.]+)", "the confidence cut-off"))


def ask(url, model, key, note, question):
    body = json.dumps({"model": model, "state": {"case_type": note["case_type"], "form": note["form"], "clerk_note": note["clerk_note"]},
                       "questions": {"problem": question}}).encode()
    headers = {"Content-Type": "application/json"}
    if key: headers["Authorization"] = "Bearer " + key
    t0 = time.perf_counter()
    with urllib.request.urlopen(urllib.request.Request(url.rstrip("/") + "/v1/systemone", body, headers), timeout=300) as r:
        answer = json.load(r)["answers"]["problem"]
    return answer["choice"], float(answer.get("confidence", 0)), (time.perf_counter() - t0) * 1000


def pct(n, d): return f"{n} of {d} ({round(100 * n / d) if d else 0}%)"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--url", help="a /v1/systemone server, for example http://127.0.0.1:8009")
    ap.add_argument("--model", default="kev-latest", help="model name sent in the request (default kev-latest)")
    ap.add_argument("--key", default=os.environ.get("KEV_API_KEY", ""), help="bearer key, if the server wants one")
    ap.add_argument("--notes", default=os.path.join(ROOT, "tests", "tagging", "notes.csv"))
    ap.add_argument("--all", action="store_true", help="list every note, not only the misses")
    a = ap.parse_args()

    tags, rules, question, cutoff = from_page()
    notes = list(csv.DictReader(open(a.notes, encoding="utf-8", newline="")))
    for n in notes:
        if n["expected"] not in tags + [NONE]: sys.exit(f"Unknown expected tag in {a.notes}: {n['expected']!r}")
        n["rules"] = [t for t in dict.fromkeys(tag for rx, tag in rules if rx.search(n["clerk_note"]))]
    listed = sum(n["expected"] != NONE for n in notes)
    print(f"{len(notes)} notes: {listed} name a problem on the list, {len(notes) - listed} do not\n")

    def rules_result(n):
        if not n["rules"]: return "none"
        if n["rules"] == [n["expected"]]: return "right"
        return "partly" if n["expected"] in n["rules"] else "wrong"

    count = lambda xs, v: sum(x == v for x in xs)
    rr = [rules_result(n) for n in notes]
    print("Keyword rules alone")
    print(f"  right {count(rr, 'right')}   right plus an extra tag {count(rr, 'partly')}   wrong {count(rr, 'wrong')}   no match {count(rr, 'none')}\n")

    if a.url:
        try:
            for i, n in enumerate(notes):
                n["choice"], n["confidence"], n["ms"] = ask(a.url, a.model, a.key, n, question)
                print(f"\r  asked the model about {i + 1} of {len(notes)} notes", end="", file=sys.stderr, flush=True)
            print(file=sys.stderr)
        except (urllib.error.URLError, OSError, KeyError, ValueError) as e:
            sys.exit(f"\nThe model at {a.url} did not answer: {e}")

        right = [n["choice"] == n["expected"] for n in notes]
        print(f"Model alone ({a.model} at {a.url}), its top answer on every note")
        print(f"  right {pct(sum(right), len(notes))}   median {round(statistics.median(n['ms'] for n in notes))} ms per note")
        for t in tags + [NONE]:
            mine = [n for n in notes if n["expected"] == t]
            print(f"    {t:<32} {sum(n['choice'] == t for n in mine)} of {len(mine)}")

        def flow(n, cut):
            """What Import shows for this note: the rules' answer, else the model's if it is sure enough, else review."""
            if n["rules"]: return rules_result(n)
            if n["choice"] in tags and n["confidence"] >= cut: return "right" if n["choice"] == n["expected"] else "wrong"
            return "right" if n["expected"] == NONE else "review"

        fr = [flow(n, cutoff) for n in notes]
        print(f"\nRules first, then the model on what the rules could not sort (what Import does), cut-off {cutoff}")
        print(f"  right {pct(count(fr, 'right'), len(notes))}   right plus an extra tag {count(fr, 'partly')}   wrong {count(fr, 'wrong')}   a real problem left for review {count(fr, 'review')}")

        left = [n for n in notes if not n["rules"]]
        print(f"\nChoosing the cut-off, on the {len(left)} notes the rules could not sort")
        print("  cut-off   model answers kept   wrong among those kept")
        for cut in (0.0, 0.2, 0.4, 0.6, 0.8):
            kept = [n for n in left if n["choice"] in tags and n["confidence"] >= cut]
            print(f"  {cut:<9} {len(kept):<20} {sum(n['choice'] != n['expected'] for n in kept)}")

    print("\nNotes" if a.all else "\nMisses")
    for n, r in zip(notes, rr):
        model = f"   model: {n['choice']} ({n['confidence']:.2f})" if a.url else ""
        missed = r in ("wrong", "partly") or (a.url and n["choice"] != n["expected"]) or (not a.url and r == "none" and n["expected"] != NONE)
        if a.all or missed:
            print(f"  {n['clerk_note']}\n      right answer: {n['expected']}   rules: {', '.join(n['rules']) or 'no match'}{model}")


if __name__ == "__main__":
    main()
