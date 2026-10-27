"""Loading of the regulations library and automatic linking of requirements to provisions."""

import json
import re
from datetime import date
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Provision, Regulation, Requirement, RequirementProvision

REG_DIR = Path(__file__).resolve().parent.parent / "seed" / "regulations"
REG_FILES = [
    "nis2_directive.json",
    "ir_2024_2690.json",
    "bsig.json",
    "cbw_nl.json",
    "cbb_nl.json",
    "iso27001_2022.json",
    "stoerfallv.json",
]


def _mapping() -> dict:
    return json.loads((REG_DIR / "mapping.json").read_text())


def load_regulations(db: Session, only_missing: bool = True) -> int:
    """Insert regulation texts from the bundled JSON files. Returns number of regulations loaded."""
    loaded = 0
    for order, fname in enumerate(REG_FILES):
        data = json.loads((REG_DIR / fname).read_text())
        reg = db.scalar(select(Regulation).where(Regulation.code == data["code"]))
        if reg and only_missing:
            continue
        if reg:
            db.execute(delete(Provision).where(Provision.regulation_id == reg.id))
        else:
            reg = Regulation(code=data["code"])
            db.add(reg)
        reg.title = data["title"]
        reg.short_title = data["short_title"]
        reg.kind = data["kind"]
        reg.jurisdiction = data["jurisdiction"]
        reg.language = data["language"]
        reg.version_date = date.fromisoformat(data["version_date"]) if data.get("version_date") else None
        reg.source_url = data.get("source_url")
        reg.status_note = data.get("status_note")
        reg.license_note = data.get("license_note")
        reg.sort_order = order
        reg.is_builtin = True
        db.flush()

        counter = [0]

        def add(nodes, parent_id, depth, reg=reg, counter=counter):
            for n in nodes:
                counter[0] += 1
                p = Provision(
                    regulation_id=reg.id,
                    parent_id=parent_id,
                    key=n["key"],
                    ref=n.get("ref") or n["key"],
                    heading=n.get("heading"),
                    text=n.get("text") or None,
                    depth=depth,
                    sort_order=counter[0] * 10,
                )
                db.add(p)
                db.flush()
                add(n.get("children") or [], p.id, depth + 1, reg, counter)

        add(data["provisions"], None, 0)
        loaded += 1
    db.commit()
    return loaded


def add_annex_requirement_texts(db: Session) -> None:
    """The requirement texts of chapters 1-13 are verbatim IR 2024/2690 Annex points: make them browsable."""
    reg = db.scalar(select(Regulation).where(Regulation.code == "IR2024/2690"))
    if not reg:
        return
    provs = {p.key: p for p in db.scalars(select(Provision).where(Provision.regulation_id == reg.id))}
    reqs = db.scalars(select(Requirement).order_by(Requirement.sort_order)).all()
    for req in reqs:
        if req.chapter.number > 13:
            continue
        key = f"annex.{req.number}"
        if key in provs:
            continue
        section_key = "annex." + ".".join(req.number.split(".")[:2])
        parent = provs.get(section_key) or provs.get(f"annex.{req.chapter.number}")
        if not parent:
            continue
        text = req.text + (("\n" + req.check_points) if req.check_points else "")
        p = Provision(
            regulation_id=reg.id,
            parent_id=parent.id,
            key=key,
            ref=f"Annex, point {req.number}.",
            heading=None,
            text=text,
            depth=parent.depth + 1,
            sort_order=parent.sort_order + int(req.number.split(".")[-1]),
        )
        db.add(p)
        provs[key] = p
    db.commit()


_BSIG_REF = re.compile(r"§\s*(\d+[a-z]?)((?:(?!§).)*)")


def parse_bsig_reference(ref: str) -> list[str]:
    """'§ 30 Abs. 2 Nr. 9 und 10 BSIG' -> ['30.2.9', '30.2.10'];
    '§ 30 Abs. 1 und Abs. 2 Nr. 1 BSIG' -> ['30.1', '30.2.1'];
    '§ 32 Abs. 1 Satz 1 Nr. 3 und 4 sowie Abs. 2 BSIG' -> ['32.1.3', '32.1.4', '32.2']"""
    keys: list[str] = []
    for m in _BSIG_REF.finditer(ref):
        par, rest = m.group(1), m.group(2)
        # split into Absatz groups
        abs_parts = re.split(r"Abs\.\s*", rest)
        found = False
        for part in abs_parts[1:]:
            am = re.match(r"(\d+)", part)
            if not am:
                continue
            absatz = am.group(1)
            nrm = re.search(r"Nr\.\s*([\d,\sund]+)", part)
            if nrm:
                for nr in re.findall(r"\d+", nrm.group(1)):
                    keys.append(f"{par}.{absatz}.{nr}")
            else:
                keys.append(f"{par}.{absatz}")
            found = True
        if not found:
            keys.append(par)
    return keys


def parse_iso_reference(ref: str) -> list[str]:
    return [x.strip() for x in ref.split(",") if x.strip()]


def link_requirements(db: Session, rebuild: bool = False) -> int:
    """Create automatic requirement <-> provision links. Manually curated links are never touched."""
    if rebuild:
        db.execute(delete(RequirementProvision).where(RequirementProvision.is_auto.is_(True)))
        db.commit()
    regs = {r.code: r for r in db.scalars(select(Regulation))}
    prov_index: dict[tuple[str, str], Provision] = {}
    for p in db.scalars(select(Provision)):
        prov_index[(p.regulation.code, p.key)] = p

    def resolve(code: str, key: str) -> Provision | None:
        k = key
        while k:
            p = prov_index.get((code, k))
            if p:
                return p
            if "." not in k:
                return None
            k = k.rsplit(".", 1)[0]
        return None

    mapping = _mapping()
    chapter_links = mapping.get("chapter_links", {})
    bsig_to_nis2 = mapping.get("bsig_nr_to_nis2", {})
    existing = {(rp.requirement_id, rp.provision_id) for rp in db.scalars(select(RequirementProvision))}
    count = 0

    def link(req: Requirement, prov: Provision | None, relation: str) -> None:
        nonlocal count
        if not prov or (req.id, prov.id) in existing:
            return
        existing.add((req.id, prov.id))
        db.add(
            RequirementProvision(requirement_id=req.id, provision_id=prov.id, relation=relation, is_auto=True)
        )
        count += 1

    for req in db.scalars(select(Requirement)):
        ch = req.chapter.number
        # 1) exact IR 2024/2690 annex point (benchmark source)
        if ch <= 13 and "IR2024/2690" in regs:
            link(req, resolve("IR2024/2690", f"annex.{req.number}"), "benchmark")
        # 2) German legal basis parsed from the legal reference column
        bsig_keys = parse_bsig_reference(req.legal_reference or "")
        for k in bsig_keys:
            link(req, resolve("BSIG", k), "legal_basis")
            parts = k.split(".")
            if parts[0] == "30" and len(parts) == 3 and parts[1] == "2" and parts[2] in bsig_to_nis2:
                link(req, resolve("NIS2", bsig_to_nis2[parts[2]]), "legal_basis")
        if "BImSchV" in (req.legal_reference or ""):
            link(req, resolve("STOERFALLV", "3"), "legal_basis")
        # 3) chapter-level links (NIS2 article, Dutch equivalents, Störfall-V)
        for entry in chapter_links.get(str(ch), []):
            code = entry["reg"]
            if code in ("ISO27001", "IR2024/2690"):
                continue  # handled more precisely per requirement
            if code == "BSIG" and bsig_keys:
                continue
            relation = "national_equivalent" if code in ("CBW", "CBB") else "legal_basis"
            link(req, resolve(code, entry["key"]), relation)
        # 4) ISO/IEC 27001:2022 cross references
        for k in parse_iso_reference(req.iso_reference or ""):
            link(req, resolve("ISO27001", k), "iso_mapping")
    db.commit()
    return count
