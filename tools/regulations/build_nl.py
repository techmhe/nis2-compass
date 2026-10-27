import json, re, sys
from bwb_parse import load, walk_body, rowspan_rows, txt, norm

import os as _os
REG = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "backend", "app", "seed", "regulations")
D = REG + "/"
notes = json.load(open("nl_status.json", encoding="utf-8")) if len(sys.argv) > 1 else {}


def bijlage_node(b):
    kop = b.find("kop")
    nr = norm(kop.findtext("nr"))
    titel = kop.find("titel")
    node = {"key": f"bijlage{nr}", "ref": f"Bijlage {nr}", "heading": txt(titel) if titel is not None else None, "text": "", "children": []}
    tbl = b.find(".//table")
    if tbl is None:
        node["text"] = "\n".join(txt(a) for a in b.iter("al"))
        return node
    hdr = [txt(e) for e in tbl.findall("tgroup/thead/row/entry")]
    node["text"] = " | ".join(hdr)
    rows = rowspan_rows(tbl)
    sectors, order = {}, []
    for r in rows:
        s = r[0]
        if s not in sectors:
            sectors[s] = []
            order.append(s)
        sectors[s].append(r[1:])
    for i, s in enumerate(order, 1):
        lines, last = [], None
        for sub in sectors[s]:
            if len(sub) > 1 and sub[0] and sub[0] != last:
                lines.append(sub[0])
                last = sub[0]
            lines.extend(sub[-1].split("\n"))
        node["children"].append({"key": f"bijlage{nr}.{i}", "ref": f"Bijlage {nr}, sector {i}", "heading": s,
                                 "text": "\n".join(l for l in lines if l), "children": []})
    return node


def build(src, out, code, title, short, kind, url, status_key):
    root = load(src)
    wet = root.find("wetgeving")
    intitule = txt(wet.find("intitule"))
    provisions = []
    for wb in wet.iter("wet-besluit"):
        for c in wb:
            if c.tag == "wettekst":
                walk_body(c, provisions)
    for b in wet.iter("bijlage"):
        provisions.append(bijlage_node(b))
    iwt = root.get("inwerkingtreding")
    doc = {
        "code": code, "title": f"{title} — {intitule}" if intitule and title not in intitule else intitule or title,
        "short_title": short, "kind": kind, "jurisdiction": "NL", "language": "nl",
        "version_date": iwt, "source_url": url,
        "status_note": notes.get(status_key, ""),
        "license_note": "Officiële tekst via wetten.overheid.nl (Basiswettenbestand, BWB-XML, open data). Wettelijke regelingen zijn niet auteursrechtelijk beschermd (art. 11 Auteurswet).",
        "provisions": provisions,
    }
    json.dump(doc, open(D + out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("written", out)


build("BWBR0052872.xml", "cbw_nl.json", "CBW", "Cyberbeveiligingswet", "Cyberbeveiligingswet (Cbw)", "national_law",
      "https://wetten.overheid.nl/BWBR0052872/2026-08-15/0", "cbw")
build("BWBR0052875.xml", "cbb_nl.json", "CBB", "Cyberbeveiligingsbesluit", "Cyberbeveiligingsbesluit (Cbb)", "national_ordinance",
      "https://wetten.overheid.nl/BWBR0052875/2026-08-15/0", "cbb")
