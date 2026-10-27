"""Parse Dutch BWB 'toestand' XML (wetten.overheid.nl) into provision trees."""
import re
import xml.etree.ElementTree as ET

SKIP = {"meta-data", "redactie"}


def norm(s):
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ")).strip()


def txt(el):
    parts = []

    def rec(e):
        if e.tag in SKIP:
            if e.tail:
                parts.append(e.tail)
            return
        if e.text:
            parts.append(e.text)
        for c in e:
            rec(c)
        if e.tail and e is not el:
            parts.append(e.tail)

    rec(el)
    return norm("".join(parts))


def fill(node, el, ref):
    """el = lid / artikel / li: collect <al> texts and <lijst> items (in order)."""
    texts = []
    for c in el:
        if c.tag == "al":
            t = txt(c)
            if t:
                texts.append(t)
        elif c.tag == "lijst":
            parse_lijst(node, c, ref)
        elif c.tag == "table":
            texts.extend(table_lines(c))
        elif c.tag in ("kop", "lidnr", "li.nr", "meta-data", "redactie"):
            continue
    node["text"] = "\n".join(texts)


def parse_lijst(node, lijst, ref):
    anon = 0
    for li in lijst.findall("li"):
        lbl = norm(li.findtext("li.nr") or "")
        m = re.match(r"^([0-9]+[a-z]*|[a-z]{1,4})[.)]?$", lbl)
        if m and lbl not in ("–", "-", "•"):
            k = m.group(1).lower()
            r = f"{ref}, onderdeel {k}" if "onderdeel" not in ref else f"{ref}, sub {k}"
        else:
            anon += 1
            k = f"i{anon}"
            r = f"{ref}, streepje {anon}"
        child = {"key": f"{node['key']}.{k}", "ref": r, "heading": None, "text": "", "children": []}
        fill(child, li, r)
        node["children"].append(child)


def table_lines(tbl):
    lines = []
    for row in tbl.iter("row"):
        cells = [txt(e) for e in row.findall("entry")]
        cells = [c for c in cells if c]
        if cells:
            lines.append(" | ".join(cells))
    return lines


def parse_artikel(a):
    kop = a.find("kop")
    nr = norm(kop.findtext("nr"))
    titel = kop.find("titel")
    heading = txt(titel) if titel is not None else None
    if heading:
        heading = re.sub(r"^\((.*)\)$", r"\1", heading)
    ref = f"Art. {nr}"
    art = {"key": nr, "ref": ref, "heading": heading, "text": "", "children": []}
    leden = a.findall("lid")
    if not leden:
        fill(art, a, ref)
        return art
    pre = [txt(c) for c in a if c.tag == "al"]
    art["text"] = "\n".join(p for p in pre if p)
    for lid in leden:
        ln = norm(lid.findtext("lidnr"))
        lref = f"Art. {nr} lid {ln}"
        node = {"key": f"{nr}.{ln}", "ref": lref, "heading": None, "text": "", "children": []}
        fill(node, lid, lref)
        art["children"].append(node)
    return art


def group_node(el, prefix):
    kop = el.find("kop")
    label = norm(kop.findtext("label"))
    nr = norm(kop.findtext("nr"))
    titel = kop.find("titel")
    heading = txt(titel) if titel is not None else None
    short = {"Hoofdstuk": "h", "§": "par", "Paragraaf": "par", "Afdeling": "afd", "Titel": "titel"}.get(label, label.lower())
    last = nr.split(".")[-1]
    key = f"{prefix}{short}{last}"
    return {"key": key, "ref": f"{label} {nr}", "heading": heading, "text": "", "children": []}


def walk_body(el, out, prefix=""):
    for c in el:
        if c.tag in ("hoofdstuk", "paragraaf", "afdeling", "titel") and c.find("kop") is not None:
            g = group_node(c, prefix)
            walk_body(c, g["children"], g["key"] + ".")
            out.append(g)
        elif c.tag == "artikel":
            out.append(parse_artikel(c))
        elif c.tag in ("wettekst", "regeling-tekst", "circulaire-tekst"):
            walk_body(c, out, prefix)


def rowspan_rows(tbl):
    """Rows with morerows (rowspan) carried forward."""
    rows = []
    carry = {}
    tb = tbl.find("tgroup/tbody")
    ncols = int(tbl.find("tgroup").get("cols"))
    for row in tb.findall("row"):
        entries = row.findall("entry")
        r = []
        ei = 0
        for col in range(1, ncols + 1):
            cname = f"col{col}"
            if cname in carry and carry[cname][0] > 0:
                r.append(carry[cname][1])
                carry[cname] = (carry[cname][0] - 1, carry[cname][1])
                continue
            if ei < len(entries):
                e = entries[ei]
                if e.get("colname") and e.get("colname") != cname:
                    r.append("")
                    continue
                ei += 1
                t = "\n".join(txt(a) for a in e.findall("al")) or txt(e)
                mr = int(e.get("morerows", "0") or 0)
                if mr:
                    carry[cname] = (mr, t)
                r.append(t)
            else:
                r.append("")
        rows.append(r)
    return rows


def load(path):
    return ET.parse(path).getroot()
