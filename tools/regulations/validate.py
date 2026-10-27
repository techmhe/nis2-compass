import json, sys, re, os, glob

import os as _os
REG = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "backend", "app", "seed", "regulations")
D = REG
REQ = ["code", "title", "short_title", "kind", "jurisdiction", "language", "version_date", "source_url", "status_note",
       "license_note", "provisions"]
KINDS = {"eu_directive", "eu_regulation", "national_law", "national_ordinance", "standard"}
# expected count of "article-level" nodes: key without dot, not a structural grouping
GROUP_RE = re.compile(r"^(ch\d+|teil\d+|kap|h\d+|annex|anlage|anhang|title|part|section|abschnitt|p\d|clause)", re.I)

expected = {"NIS2": 46 + 2, "BSIG": None, "IR2024/2690": None, "CBW": None, "CBB": None, "ISO27001": None, "STOERFALLV": None}


def walk(nodes, depth=0, parent=None):
    for n in nodes:
        yield n, depth, parent
        yield from walk(n.get("children", []), depth + 1, n)


ok = True
all_keys = {}
for f in sorted(glob.glob(os.path.join(D, "*.json"))):
    if f.endswith("mapping.json"):
        continue
    d = json.load(open(f, encoding="utf-8"))
    errs = []
    for k in REQ:
        if k not in d:
            errs.append(f"missing {k}")
    if d.get("kind") not in KINDS:
        errs.append("bad kind")
    if not d.get("provisions"):
        errs.append("empty provisions")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", d.get("version_date", "")):
        errs.append("bad version_date")
    keys = set()
    n_total = 0
    arts = []
    empty_leaf = 0
    for n, depth, parent in walk(d["provisions"]):
        n_total += 1
        for fld in ("key", "ref", "text", "children"):
            if fld not in n:
                errs.append(f"node missing {fld}: {n.get('key')}")
        if n["key"] in keys:
            errs.append(f"dup key {n['key']}")
        keys.add(n["key"])
        if n["key"] != n["key"].strip() or " " in n["key"]:
            errs.append(f"bad key {n['key']!r}")
        if "." not in n["key"] and not GROUP_RE.match(n["key"]) and not n["key"].startswith("A"):
            arts.append(n["key"])
        if not n["text"] and not n["children"] and not n.get("heading"):
            empty_leaf += 1
    all_keys[d["code"]] = keys
    print(f"{os.path.basename(f)}: code={d['code']} nodes={n_total} top={len(d['provisions'])} article-level={len(arts)} empty_leaf={empty_leaf}")
    if errs:
        ok = False
        print("  ERRORS:", errs[:20])

mp = os.path.join(D, "mapping.json")
if os.path.exists(mp):
    m = json.load(open(mp, encoding="utf-8"))
    for ch, links in m["chapter_links"].items():
        for l in links:
            if l["reg"] not in all_keys:
                print(f"  mapping ch{ch}: unknown reg {l['reg']}"); ok = False
            elif l["key"] not in all_keys[l["reg"]]:
                print(f"  mapping ch{ch}: missing key {l['reg']}:{l['key']}"); ok = False
    for nr, k in m["bsig_nr_to_nis2"].items():
        if k not in all_keys.get("NIS2", set()):
            print("  bsig_nr_to_nis2 missing", k); ok = False
    print("mapping.json checked:", len(m["chapter_links"]), "chapters")
print("OK" if ok else "FAILED")
sys.exit(0 if ok else 1)
