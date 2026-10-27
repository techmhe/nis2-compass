"""Parse EUR-Lex / Publications Office OJ XHTML (CONVEX format) into provision trees."""
import re
from bs4 import BeautifulSoup, Tag

ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10}


def norm(s):
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()


def label_key(lbl):
    """'(a)' -> 'a', '(1)' -> '1', '(iv)' -> 'iv', '1.' -> '1', '—' -> None"""
    m = re.match(r"^\(?([0-9]+[a-z]?|[a-z]{1,5})\)?\.?$", lbl.strip())
    return m.group(1).lower() if m else None


def ref_suffix(lbl):
    k = label_key(lbl)
    return f"({k})" if k else ""


def parse_point_table(tbl, parent_key, parent_ref, counter):
    """A 2-column table: first td = label, second td = content."""
    tds = tbl.find("tbody").find_all("td", recursive=False) if tbl.find("tbody") else []
    if not tds:
        tr = tbl.find("tr")
        tds = tr.find_all("td", recursive=False)
    lbl = norm(tds[0].get_text(" "))
    k = label_key(lbl)
    if k is None:
        counter[0] += 1
        k = f"i{counter[0]}"  # indent/dash item
        ref = f"{parent_ref}, indent {counter[0]}"
    else:
        ref = f"{parent_ref}({k})"
    node = {"key": f"{parent_key}.{k}", "ref": ref, "heading": None, "text": "", "children": []}
    fill(node, tds[1])
    return node


def fill(node, container, skip_first_num=False):
    """Fill node text/children from container's direct children (p and tables)."""
    before, after = [], []
    counter = [0]
    for el in container.children:
        if not isinstance(el, Tag):
            continue
        if el.name == "p":
            cls = el.get("class") or []
            if any(c in ("oj-ti-art", "oj-sti-art") for c in cls):
                continue
            t = norm(el.get_text(""))
            if not t:
                continue
            (after if node["children"] else before).append(t)
        elif el.name == "table":
            node["children"].append(parse_point_table(el, node["key"], node["ref"], counter))
        elif el.name == "div":
            if el.get("class") and "eli-title" in el.get("class"):
                continue
            # nested div (rare) - recurse as text
            fill(node, el)
    txt = "\n".join(before)
    if after:
        txt = (txt + "\n" if txt else "") + "\n".join(after)
    node["text"] = (node["text"] + "\n" + txt).strip() if node["text"] else txt
    return node


def fix_point_text_spacing(t):
    return t


def parse_article(div, art_ref_prefix="Art."):
    num = norm(div.find("p", class_="oj-ti-art").get_text(" ")).replace("Article ", "")
    tdiv = div.find("div", class_="eli-title")
    heading = norm(tdiv.get_text(" ")) if tdiv else None
    art = {"key": num, "ref": f"{art_ref_prefix} {num}", "heading": heading, "text": "", "children": []}
    para_divs = [d for d in div.find_all("div", recursive=False) if re.match(r"^\d{3}\.\d{3}$", d.get("id", ""))]
    if not para_divs:
        fill(art, div)
        return art
    # text before paragraphs (rare)
    for d in para_divs:
        pnum = str(int(d["id"].split(".")[1]))
        p = {"key": f"{num}.{pnum}", "ref": f"{art_ref_prefix} {num}({pnum})", "heading": None, "text": "", "children": []}
        fill(p, d)
        # strip leading "1.   "
        p["text"] = re.sub(r"^" + re.escape(pnum) + r"\.\s+", "", p["text"])
        art["children"].append(p)
    return art


def parse_annex_table_lines(tbl):
    """Flatten an oj-table honoring rowspan; returns list of rows (list of cell texts)."""
    rows = []
    carry = {}  # col -> (remaining, text)
    for tr in tbl.find("tbody").find_all("tr", recursive=False):
        cells = tr.find_all("td", recursive=False)
        row = []
        ci = 0
        col = 0
        while ci < len(cells) or col in carry:
            if col in carry and carry[col][0] > 0:
                row.append(carry[col][1])
                carry[col] = (carry[col][0] - 1, carry[col][1])
                if carry[col][0] == 0:
                    del carry[col]
                col += 1
                continue
            if ci >= len(cells):
                break
            td = cells[ci]
            ci += 1
            parts = []
            for sub in td.find_all("table", recursive=False):
                std = sub.find_all("td")
                if len(std) >= 2:
                    parts.append(norm(std[0].get_text(" ")) + " " + norm(std[1].get_text("")))
            if not parts:
                parts = [norm(td.get_text(" "))]
            txt = "\n".join(p for p in parts if p)
            rs = int(td.get("rowspan", 1))
            if rs > 1:
                carry[col] = (rs - 1, txt)
            row.append(txt)
            col += 1
        rows.append(row)
    return rows
