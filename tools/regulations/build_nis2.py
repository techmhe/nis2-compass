import json, re, sys
from bs4 import BeautifulSoup
from eurlex_parse import norm, parse_article, parse_annex_table_lines, ROMAN

import os as _os
REG = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "backend", "app", "seed", "regulations")
OUT = REG + "/nis2_directive.json"
soup = BeautifulSoup(open("cellar_32022L2555.bin", encoding="utf-8").read(), "html.parser")
for a in soup.find_all("a", href=re.compile(r"^#ntr")):
    a.decompose()

provisions = []
for cpt in soup.find_all("div", id=re.compile(r"^cpt_[IVX]+$")):
    roman = cpt["id"].split("_")[1]
    title = norm(cpt.find("div", class_="eli-title").get_text(" "))
    ch = {"key": f"ch{ROMAN[roman]}", "ref": f"Chapter {roman}", "heading": (title.capitalize() if title.isupper() else title).replace(" union", " Union"),
          "text": "", "children": []}
    for art in cpt.find_all("div", id=re.compile(r"^art_\d+$"), recursive=False):
        ch["children"].append(parse_article(art))
    provisions.append(ch)


def annex(idx, roman):
    div = soup.find("div", id=f"anx_{roman}")
    tis = [norm(p.get_text(" ")) for p in div.find_all("p", class_="oj-doc-ti", recursive=False)]
    node = {"key": f"annex{idx}", "ref": f"Annex {roman}", "heading": tis[1].capitalize(), "text": "", "children": []}
    tbl = div.find("table", class_="oj-table")
    rows = parse_annex_table_lines(tbl)
    header = rows[0]
    node["text"] = " | ".join(header)
    sectors = {}
    order = []
    for r in rows[1:]:
        sector = r[0].split("\n")[0]
        if sector not in sectors:
            sectors[sector] = []
            order.append(sector)
        sectors[sector].append(r[1:])
    for sector in order:
        m = re.match(r"^(\d+)\.\s*(.*)$", sector)
        num, name = m.group(1), m.group(2)
        lines, last_sub = [], None
        for sub, ent in [(x[0] if len(x) > 1 else "", x[-1]) for x in sectors[sector]]:
            if len(sectors[sector][0]) > 1 and sub and sub != last_sub:
                lines.append(sub)
                last_sub = sub
            lines.extend(ent.split("\n"))
        node["children"].append({"key": f"annex{idx}.{num}", "ref": f"Annex {roman}, sector {num}", "heading": name,
                                 "text": "\n".join(l for l in lines if l.strip()), "children": []})
    return node


provisions.append(annex(1, "I"))
provisions.append(annex(2, "II"))

doc = {
    "code": "NIS2",
    "title": "Directive (EU) 2022/2555 of the European Parliament and of the Council of 14 December 2022 on measures for a high common level of cybersecurity across the Union, amending Regulation (EU) No 910/2014 and Directive (EU) 2018/1972, and repealing Directive (EU) 2016/1148 (NIS 2 Directive)",
    "short_title": "NIS2 Directive",
    "kind": "eu_directive",
    "jurisdiction": "EU",
    "language": "en",
    "version_date": "2022-12-27",
    "source_url": "https://eur-lex.europa.eu/eli/dir/2022/2555/oj",
    "status_note": "",
    "license_note": "Text from EUR-Lex / Publications Office (OJ L 333, 27.12.2022, p. 80). Reuse authorised per Commission Decision 2011/833/EU; only the Official Journal version is authentic.",
    "provisions": provisions,
}
if len(sys.argv) > 1:
    doc["status_note"] = sys.argv[1]
json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("written", OUT)
