import json, re, sys
from gii_parse import load, build_tree, norm, fill_block

import os as _os
REG = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "backend", "app", "seed", "regulations")
OUT = REG + "/stoerfallv.json"
root = load("stoer/BJNR060310000.xml")
KEEP = {"Anhang II": "2", "Anhang III": "3"}


def anhang(n, enbez):
    if enbez not in KEEP:
        return None
    num = KEEP[enbez]
    md = n.find("metadaten")
    heading = norm("".join(md.find("titel").itertext()))
    node = {"key": f"anhang{num}", "ref": enbez, "heading": heading, "text": "", "children": []}
    for p in n.find("textdaten/text/Content").findall("P"):
        tmp = {"key": node["key"], "ref": enbez, "heading": None, "text": "", "children": []}
        fill_block(tmp, p)
        node["text"] = (node["text"] + "\n" + tmp["text"]).strip()
        node["children"].extend(tmp["children"])
    return node


provisions = build_tree(root, anlage_handler=anhang)
md = root.find("norm/metadaten")
stand = "; ".join(norm(s.findtext("standkommentar")) for s in md.findall("standangabe"))
doc = {
    "code": "STOERFALLV",
    "title": "Zwölfte Verordnung zur Durchführung des Bundes-Immissionsschutzgesetzes (Störfall-Verordnung – 12. BImSchV)",
    "short_title": "Störfall-Verordnung (12. BImSchV)",
    "kind": "national_ordinance",
    "jurisdiction": "DE",
    "language": "de",
    "version_date": sys.argv[2] if len(sys.argv) > 2 else "",
    "source_url": "https://www.gesetze-im-internet.de/bimschv_12_2000/",
    "status_note": sys.argv[1] if len(sys.argv) > 1 else "",
    "license_note": "Amtliches Werk; nach § 5 Abs. 1 UrhG gemeinfrei. Quelle: gesetze-im-internet.de (XML-Fassung); Stand laut Quelle: " + stand,
    "provisions": provisions,
}
json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("written", OUT)
