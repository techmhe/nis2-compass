"""Parse gesetze-im-internet.de XML (gii-norm.dtd) into provision trees."""
import re
import xml.etree.ElementTree as ET

SKIP_TAGS = {"FnR", "noindex", "kommentar", "Footnotes", "Footnote"}


def norm(s):
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ")).strip()


def text_excluding(el, exclude=("DL", "table")):
    """Return (before, after): text before the first excluded child and text after the last one."""
    before, after = [], []
    seen = [False]

    def rec(e, top):
        if e.tag in SKIP_TAGS:
            if top is False and e.tail:
                (after if seen[0] else before).append(e.tail)
            return
        if e.tag in exclude:
            seen[0] = True
            if e.tail:
                after.append(e.tail)
            return
        if e.tag == "BR":
            (after if seen[0] else before).append(" ")
        if e.text:
            (after if seen[0] else before).append(e.text)
        for c in e:
            rec(c, False)
        if not top and e.tail:
            (after if seen[0] else before).append(e.tail)

    rec(el, True)
    return norm("".join(before)), norm("".join(after))


def item_label(dt):
    lbl = norm("".join(dt.itertext()))
    m = re.match(r"^([0-9]+[a-z]?)\.?$", lbl)
    if m:
        return m.group(1), "Nr."
    m = re.match(r"^([a-z])\)$", lbl)
    if m:
        return m.group(1), "Buchst."
    m = re.match(r"^([a-z]{2})\)$", lbl)
    if m:
        return m.group(1), "Doppelbuchst."
    m = re.match(r"^([0-9]+[a-z]?)\)$", lbl)
    if m:
        return m.group(1), "Nr."
    m = re.match(r"^([IVX]+)\.$", lbl)
    if m:
        return m.group(1).lower(), "Abschnitt"
    return None, lbl


def parse_dl(dl, parent_key, parent_ref):
    out = []
    dts = [c for c in dl if c.tag == "DT"]
    dds = [c for c in dl if c.tag == "DD"]
    n_anon = 0
    for dt, dd in zip(dts, dds):
        k, kind = item_label(dt)
        if k is None:
            n_anon += 1
            k = f"i{n_anon}"
            ref = f"{parent_ref} Spiegelstrich {n_anon}"
        else:
            ref = f"{parent_ref} {kind} {k.upper() if kind == 'Abschnitt' else k}"
        node = {"key": f"{parent_key}.{k}", "ref": ref, "heading": None, "text": "", "children": []}
        fill_block(node, dd)
        out.append(node)
    return out


def segments(el):
    """Split el's content at DL boundaries: returns (texts, dls, tables); len(texts) == len(dls) + 1."""
    segs, dls, tables = [[]], [], []

    def rec(e, top):
        if e.tag in SKIP_TAGS:
            if not top and e.tail:
                segs[-1].append(e.tail)
            return
        if e.tag == "DL":
            dls.append(e)
            segs.append([])
            if e.tail:
                segs[-1].append(e.tail)
            return
        if e.tag == "table":
            tables.append(e)
            if e.tail:
                segs[-1].append(e.tail)
            return
        if e.tag in ("BR", "LA") and segs[-1]:
            segs[-1].append(" ")
        if e.text:
            segs[-1].append(e.text)
        for c in e:
            rec(c, False)
        if not top and e.tail:
            segs[-1].append(e.tail)

    rec(el, True)
    return [norm("".join(x)) for x in segs], dls, tables


def fill_block(node, el):
    """el = P / DD / LA; sets text and children from nested DLs (in document order)."""
    containers = [c for c in el if c.tag == "LA"] if el.tag == "DD" else [el]
    if not containers:
        containers = [el]
    texts = []
    n_list = 0
    for cont in containers:
        segs, dls, tables = segments(cont)
        if segs[0]:
            texts.append(segs[0])
        for i, dl in enumerate(dls):
            n_list += 1
            if n_list == 1:
                node["children"].extend(parse_dl(dl, node["key"], node["ref"]))
            else:
                g = {"key": f"{node['key']}.l{n_list}", "ref": f"{node['ref']} ({n_list}. Aufzählung)", "heading": None,
                     "text": segs[i] if i > 0 else "", "children": []}
                if i == 0 and texts and n_list > 1:
                    pass
                g["children"] = parse_dl(dl, g["key"], node["ref"])
                node["children"].append(g)
            if i == len(dls) - 1 and segs[i + 1]:
                texts.append(segs[i + 1])
        for tbl in tables:
            texts.extend(table_lines(tbl))
    node["text"] = "\n".join(t for t in texts if t)


def table_lines(tbl):
    lines = []
    for row in tbl.iter("row"):
        cells = [norm("".join(e.itertext())) for e in row.findall("entry")]
        cells = [c for c in cells if c]
        if cells:
            lines.append(" | ".join(cells))
    return lines


def parse_section(norm_el, num, ref_prefix="§"):
    md = norm_el.find("metadaten")
    titel = md.find("titel")
    heading = norm("".join(titel.itertext())) if titel is not None else None
    sec = {"key": num, "ref": f"{ref_prefix} {num}", "heading": heading, "text": "", "children": []}
    content = norm_el.find("textdaten/text/Content")
    if content is None:
        return sec
    ps = [p for p in content if p.tag == "P"]
    cur = None
    loose = []
    for p in ps:
        before, _ = text_excluding(p)
        m = re.match(r"^\((\d+[a-z]?)\)\s*", before)
        if m:
            pn = m.group(1)
            cur = {"key": f"{num}.{pn}", "ref": f"{ref_prefix} {num} Abs. {pn}", "heading": None, "text": "", "children": []}
            fill_block(cur, p)
            cur["text"] = re.sub(r"^\(" + re.escape(pn) + r"\)\s*", "", cur["text"])
            sec["children"].append(cur)
        elif cur is not None:
            tmp = {"key": cur["key"], "ref": cur["ref"], "heading": None, "text": "", "children": []}
            fill_block(tmp, p)
            cur["text"] = (cur["text"] + "\n" + tmp["text"]).strip()
            cur["children"].extend(tmp["children"])
        else:
            tmp = {"key": num, "ref": sec["ref"], "heading": None, "text": "", "children": []}
            fill_block(tmp, p)
            loose.append(tmp)
    for t in loose:
        sec["text"] = (sec["text"] + "\n" + t["text"]).strip()
        sec["children"].extend(t["children"])
    return sec


def load(path):
    raw = open(path, encoding="utf-8").read()
    raw = re.sub(r"<!DOCTYPE[^>]*>", "", raw)
    return ET.fromstring(raw)


def build_tree(root, section_filter=None, anlage_handler=None, group_prefix=("teil", "kap", "abschn")):
    """Return provisions list with structural groups based on gliederungskennzahl (3 digits per level)."""
    provisions = []
    stack = []  # (level, node)
    meta = None
    for n in root.findall("norm"):
        md = n.find("metadaten")
        g = md.find("gliederungseinheit")
        enbez = md.findtext("enbez")
        if g is not None:
            kz = g.findtext("gliederungskennzahl")
            bez = norm(g.findtext("gliederungsbez"))
            tit = norm("".join(g.find("gliederungstitel").itertext())) if g.find("gliederungstitel") is not None else None
            level = len(kz) // 3
            gkey = group_key(bez, stack, level)
            node = {"key": gkey, "ref": bez, "heading": tit, "text": "", "children": []}
            while stack and stack[-1][0] >= level:
                stack.pop()
            (stack[-1][1]["children"] if stack else provisions).append(node)
            stack.append((level, node))
            continue
        if enbez is None:
            meta = n
            continue
        enbez = norm(enbez)
        m = re.match(r"^§+\s*(\d+[a-z]?)$", enbez)
        if m:
            num = m.group(1)
            if section_filter and not section_filter(num):
                continue
            sec = parse_section(n, num)
            (stack[-1][1]["children"] if stack else provisions).append(sec)
        elif anlage_handler and re.match(r"^(Anlage|Anhang)", enbez):
            node = anlage_handler(n, enbez)
            if node:
                provisions.append(node)
    # prune empty groups
    def prune(nodes):
        out = []
        for x in nodes:
            x["children"] = prune(x["children"])
            if x["children"] or x["text"] or re.match(r"^\d", x["key"]) or x["key"].startswith(("anlage", "anhang")):
                out.append(x)
        return out
    return prune(provisions)


ROMAN_WORDS = {"Erster": 1, "Zweiter": 2, "Dritter": 3, "Vierter": 4, "Fünfter": 5, "Sechster": 6, "Siebter": 7,
               "Achter": 8, "Neunter": 9, "Zehnter": 10}


def group_key(bez, stack, level):
    m = re.match(r"^(Teil|Kapitel|Abschnitt|Unterabschnitt)\s+(\d+[a-z]?)$", bez)
    if m:
        kind, num = m.group(1), m.group(2)
    else:
        m = re.match(r"^(\w+)\s+(Teil|Abschnitt)$", bez)
        kind, num = m.group(2), str(ROMAN_WORDS.get(m.group(1), m.group(1)))
    short = {"Teil": "teil", "Kapitel": "kap", "Abschnitt": "abschn", "Unterabschnitt": "uabschn"}[kind]
    parents = [s for s in stack if s[0] < level]
    prefix = parents[-1][1]["key"] + "." if parents else ""
    return f"{prefix}{short}{num}"
