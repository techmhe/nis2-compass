import json, re, sys
from gii_parse import load, build_tree, norm

import os as _os
REG = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "backend", "app", "seed", "regulations")
OUT = REG + "/bsig.json"
root = load("bsig/BJNR12D0B0025.xml")


def anlage(n, enbez):
    num = enbez.split()[-1]
    md = n.find("metadaten")
    heading = norm("".join(md.find("titel").itertext())) if md.find("titel") is not None else None
    node = {"key": f"anlage{num}", "ref": enbez, "heading": heading, "text": "", "children": []}
    content = n.find("textdaten/text/Content")
    groups = {}
    intro = []
    for tbl in content.iter("table"):
        head = tbl.find("tgroup/thead")
        if head is not None:
            rows = head.findall("row")
            hdr = [norm("".join(e.itertext())) for e in rows[-1].findall("entry")]
            intro.append(" | ".join(hdr))
        for row in tbl.find("tgroup/tbody").findall("row"):
            cells = [norm("".join(e.itertext())) for e in row.findall("entry")]
            nr = cells[0]
            rest = [c for c in cells[1:] if c]
            top = nr.split(".")[0]
            if not re.match(r"^\d+$", top):
                intro.append(" | ".join(c for c in cells if c))
                continue
            if top not in groups:
                groups[top] = {"key": f"anlage{num}.{top}", "ref": f"{enbez} Nr. {top}", "heading": re.sub(r"(\w)- ([a-zäöü])", r"\1\2", " ".join(rest)), "text": "", "children": []}
                node["children"].append(groups[top])
                continue
            line = f"{nr} {' | '.join(rest)}".strip()
            groups[top]["text"] = (groups[top]["text"] + "\n" + line).strip()
    # other paragraphs (non-table) in content
    for p in content.findall("P"):
        if p.find("table") is None and p.find("noindex") is None:
            t = norm("".join(p.itertext()))
            if t:
                intro.append(t)
    node["text"] = "\n".join(intro)
    return node


provisions = build_tree(root, anlage_handler=anlage)
md = root.find("norm/metadaten")
stand = "; ".join(norm(s.findtext("standkommentar")) for s in md.findall("standangabe"))

doc = {
    "code": "BSIG",
    "title": "Gesetz über das Bundesamt für Sicherheit in der Informationstechnik und über die Sicherheit in der Informationstechnik von Einrichtungen (BSI-Gesetz – BSIG)",
    "short_title": "BSI-Gesetz (BSIG)",
    "kind": "national_law",
    "jurisdiction": "DE",
    "language": "de",
    "version_date": sys.argv[2] if len(sys.argv) > 2 else "",
    "source_url": "https://www.gesetze-im-internet.de/bsig_2025/",
    "status_note": sys.argv[1] if len(sys.argv) > 1 else "",
    "license_note": "Amtliches Werk; nach § 5 Abs. 1 UrhG gemeinfrei. Quelle: gesetze-im-internet.de (Bundesministerium der Justiz / juris), XML-Fassung; Stand laut Quelle: " + stand,
    "provisions": provisions,
}
json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("written", OUT)
