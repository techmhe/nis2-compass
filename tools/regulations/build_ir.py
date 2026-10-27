import json, re, sys
from bs4 import BeautifulSoup
from eurlex_parse import norm, parse_article

import os as _os
REG = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "backend", "app", "seed", "regulations")
OUT = REG + "/ir_2024_2690.json"
soup = BeautifulSoup(open("cellar_32024R2690.bin", encoding="utf-8").read(), "html.parser")
for a in soup.find_all("a", href=re.compile(r"^#ntr")):
    a.decompose()

provisions = [parse_article(d) for d in soup.find_all("div", id=re.compile(r"^art_\d+$"))]

anx = soup.find("div", id="anx_1")
tis = [norm(p.get_text("")) for p in anx.find_all("p", class_="oj-doc-ti")]
annex = {"key": "annex", "ref": "Annex", "heading": tis[1], "text": "", "children": []}
secs = {}
for p in anx.find_all("p", class_="oj-ti-grseq-1"):
    t = norm(p.get_text(""))
    m = re.match(r"^(\d+(?:\.\d+)?)\.\s+(.*)$", t)
    num, head = m.group(1), m.group(2)
    node = {"key": f"annex.{num}", "ref": f"Annex, point {num}.", "heading": head, "text": "", "children": []}
    if "." in num:
        secs[num.split(".")[0]]["children"].append(node)
    else:
        secs[num] = node
        annex["children"].append(node)
provisions.append(annex)

doc = {
    "code": "IR2024/2690",
    "title": "Commission Implementing Regulation (EU) 2024/2690 of 17 October 2024 laying down rules for the application of Directive (EU) 2022/2555 as regards technical and methodological requirements of cybersecurity risk-management measures and further specification of the cases in which an incident is considered to be significant with regard to DNS service providers, TLD name registries, cloud computing service providers, data centre service providers, content delivery network providers, managed service providers, managed security service providers, providers of online market places, of online search engines and of social networking services platforms, and trust service providers",
    "short_title": "NIS2 Implementing Regulation (EU) 2024/2690",
    "kind": "eu_regulation",
    "jurisdiction": "EU",
    "language": "en",
    "version_date": "2024-10-18",
    "source_url": "https://eur-lex.europa.eu/eli/reg_impl/2024/2690/oj",
    "status_note": sys.argv[1] if len(sys.argv) > 1 else "",
    "license_note": "Text from EUR-Lex / Publications Office (OJ L, 2024/2690, 18.10.2024). Reuse authorised per Commission Decision 2011/833/EU; only the Official Journal version is authentic. Annex requirement texts intentionally omitted here (headings only).",
    "provisions": provisions,
}
json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("written", OUT, len(provisions) - 1, "articles")
