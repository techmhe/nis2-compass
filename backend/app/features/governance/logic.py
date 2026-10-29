"""Governance calculations: legal-basis tagging rules, effective status per entity, training status,
recurrence and notification helpers. Kept free of FastAPI so seeders, tests and other modules can reuse it."""

import calendar
import re
from collections import defaultdict
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import build_principal
from app.features.governance.models import (
    BoardMember,
    EntityProfile,
    Obligation,
    RequirementLegal,
    TrainingRecord,
    TrainingRule,
)
from app.features.governance.validation import user_can_read_gov
from app.models import Entity, Provision, Requirement, RequirementProvision, User

RECURRENCE_MONTHS = {"monthly": 1, "quarterly": 3, "semiannual": 6, "annual": 12, "biennial": 24}
DUE_SOON_DAYS = 30
TRAINING_DUE_WINDOW_DAYS = 90
CHANGE_REPORT_DAYS = 14


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def next_due(d: date, recurrence: str) -> date | None:
    n = RECURRENCE_MONTHS.get(recurrence)
    return add_months(d, n) if n else None


def due_state(due: date | None, done: bool, today: date | None = None) -> str:
    """open | due_soon | overdue | done"""
    if done:
        return "done"
    if not due:
        return "open"
    today = today or date.today()
    if due < today:
        return "overdue"
    if (due - today).days <= DUE_SOON_DAYS:
        return "due_soon"
    return "open"


# --------------------------------------------------------------------------- legal-basis tagging


def _num_key(k: str) -> tuple:
    return tuple(int(x) if x.isdigit() else 10_000 + ord(x[0]) for x in re.split(r"[.]", k))


def bsig_label(keys: list[str]) -> str:
    """['30.2.3', '30.2.5'] -> '§ 30(2) Nr. 3, 5 BSIG'; ['32.1.3', '32.2'] -> '§ 32(1) Nr. 3; § 32(2) BSIG'."""
    groups: dict[tuple[str, str | None], list[str]] = {}
    for k in sorted(set(keys), key=_num_key):
        parts = k.split(".")
        head = (parts[0], parts[1] if len(parts) > 1 else None)
        groups.setdefault(head, [])
        if len(parts) > 2:
            groups[head].append(parts[2])
    out = []
    for (sec, para), nrs in groups.items():
        s = f"§ {sec}" + (f"({para})" if para else "")
        if nrs:
            s += " Nr. " + ", ".join(nrs)
        out.append(s)
    return "; ".join(out) + " BSIG" if out else "BSIG"


def nl_label(code: str, keys: list[str]) -> str:
    """Cbw/Cbb keys '21.3.a' -> 'Art. 21(3)(a)'; consecutive whole articles collapse to 'Art. 25–29'."""
    name = "Cbw" if code == "CBW" else "Cbb"
    keys = sorted(set(keys), key=_num_key)
    whole = [int(k) for k in keys if k.isdigit()]
    parts: list[str] = []
    if whole and len(whole) == len(keys):
        runs: list[list[int]] = []
        for n in whole:
            if runs and n == runs[-1][-1] + 1:
                runs[-1].append(n)
            else:
                runs.append([n])
        parts = [f"{r[0]}–{r[-1]}" if len(r) > 2 else ", ".join(map(str, r)) for r in runs]
        return f"{name} Art. {', '.join(parts)}"
    for k in keys:
        p = k.split(".")
        s = p[0] + (f"({p[1]})" if len(p) > 1 else "") + (f"({p[2]})" if len(p) > 2 else "")
        parts.append(s)
    return f"{name} Art. {', '.join(parts)}"


NL_CHAPTER_CBW = {14: range(25, 30), 15: range(43, 45), 16: range(24, 25)}
DE_BINDING_CHAPTERS = {14: ("32",), 15: ("33", "34"), 16: ("38",)}
IR_NOTE = (
    "Binding only for entities within the scope of IR (EU) 2024/2690 (DNS, TLD, cloud, data centre, CDN, "
    "MSP/MSSP, marketplaces, search engines, social networks, trust services). Enable it in the entity profile "
    "if an entity becomes such a provider."
)


def compute_legal_rows(db: Session) -> list[dict]:
    """Automatic legal-basis tags derived from the requirement ↔ provision links and the chapter numbers."""
    links: dict[int, dict[str, list[Provision]]] = defaultdict(lambda: defaultdict(list))
    for rp in db.scalars(select(RequirementProvision)):
        p = rp.provision
        links[rp.requirement_id][p.regulation.code].append(p)
    rows: list[dict] = []
    for req in db.scalars(select(Requirement).order_by(Requirement.sort_order)):
        ch = req.chapter.number
        lk = links.get(req.id, {})
        bsig = sorted(lk.get("BSIG", []), key=lambda p: _num_key(p.key))
        cbb = sorted(lk.get("CBB", []), key=lambda p: _num_key(p.key))
        cbw = sorted(lk.get("CBW", []), key=lambda p: _num_key(p.key))
        ir = lk.get("IR2024/2690", [])

        # ---- Germany
        de: dict = {"jurisdiction": "DE"}
        if ch in DE_BINDING_CHAPTERS:
            basis = [p for p in bsig if p.key.split(".")[0] in DE_BINDING_CHAPTERS[ch]]
            de.update(
                status="binding",
                provisions=basis,
                note="Statutory duty of the entity; the requirement restates the BSIG provision.",
            )
        elif ch == 17:
            basis = [p for p in bsig if p.key == "30.1"] or bsig[:1]
            de.update(
                status="benchmark",
                provisions=basis,
                note="Binding basis is the general duty in § 30(1) BSIG (appropriate, proportionate measures, "
                "documented). Störfall-Verordnung duties bind only establishments under the 12. BImSchV; "
                "check per site and change to binding where they apply.",
            )
        else:
            basis = [p for p in bsig if p.key.startswith("30.2")]
            if basis:
                de.update(
                    status="binding",
                    provisions=basis,
                    note="Statutory duty under § 30(2) BSIG. The annex point of IR (EU) 2024/2690 shows how the "
                    "duty can be met; the regulation itself does not apply to this entity type (§ 30(3) BSIG).",
                )
            else:
                de.update(
                    status="benchmark",
                    provisions=[p for p in bsig if p.key == "30.1"] or bsig[:1],
                    note="No § 30(2) BSIG topic is linked; the requirement concretises the general duty in "
                    "§ 30(1) BSIG (appropriate, proportionate measures).",
                )
        de["label"] = bsig_label([p.key for p in de["provisions"]]) if de["provisions"] else None
        de["requirement_id"] = req.id
        rows.append(de)

        # ---- Netherlands
        nl: dict = {"jurisdiction": "NL", "requirement_id": req.id}
        if ch <= 13:
            basis = [p for p in cbb if p.key.isdigit() and 6 <= int(p.key) <= 18]
            if basis:
                nl.update(
                    status="binding",
                    provisions=basis,
                    label=nl_label("CBB", [p.key for p in basis]),
                    note="Cyberbeveiligingsbesluit Art. 6–18 bind entities outside IR (EU) 2024/2690; the IR "
                    "annex point shows how the duty can be met.",
                )
        elif ch in NL_CHAPTER_CBW:
            rng = NL_CHAPTER_CBW[ch]
            basis = [p for p in cbw if p.key.split(".")[0].isdigit() and int(p.key.split(".")[0]) in rng]
            if basis:
                nl.update(
                    status="binding",
                    provisions=basis,
                    label=nl_label("CBW", [p.key for p in basis]),
                    note="Statutory duty under the Cyberbeveiligingswet.",
                )
        if "status" not in nl:
            basis = [p for p in cbw if p.key.startswith("21")]
            nl.update(
                status="benchmark",
                provisions=basis,
                label=nl_label("CBW", [p.key for p in basis]) if basis else None,
                note="No specific binding provision; the requirement concretises the general duty of care "
                "in Cbw Art. 21.",
            )
        rows.append(nl)

        # ---- EU (IR 2024/2690, binding only for digital providers)
        if ir:
            p = ir[0]
            rows.append(
                {
                    "jurisdiction": "EU",
                    "requirement_id": req.id,
                    "status": "benchmark",
                    "provisions": [p],
                    "label": f"IR 2024/2690 Annex {req.number}",
                    "note": IR_NOTE,
                }
            )
    for r in rows:
        r["basis_provision_id"] = r["provisions"][0].id if r.get("provisions") else None
    return rows


def rebuild_legal(db: Session, overwrite_curated: bool = False) -> int:
    """(Re)create automatic tags; curated rows (is_auto = False) are kept unless overwrite_curated."""
    existing = {(r.requirement_id, r.jurisdiction): r for r in db.scalars(select(RequirementLegal))}
    n = 0
    for row in compute_legal_rows(db):
        cur = existing.get((row["requirement_id"], row["jurisdiction"]))
        if cur and not cur.is_auto and not overwrite_curated:
            continue
        if not cur:
            cur = RequirementLegal(requirement_id=row["requirement_id"], jurisdiction=row["jurisdiction"])
            db.add(cur)
        cur.status = row["status"]
        cur.basis_provision_id = row["basis_provision_id"]
        cur.basis_label = row.get("label")
        cur.note = row.get("note")
        cur.is_auto = True
        n += 1
    db.flush()
    return n


def legal_row_dict(r: RequirementLegal, prov: Provision | None) -> dict:
    return {
        "id": r.id,
        "requirement_id": r.requirement_id,
        "jurisdiction": r.jurisdiction,
        "status": r.status,
        "basis_provision_id": r.basis_provision_id,
        "basis_label": r.basis_label,
        "note": r.note,
        "is_auto": r.is_auto,
        "regulation_id": prov.regulation_id if prov else None,
        "regulation_code": prov.regulation.code if prov else None,
    }


def effective_for_entity(
    db: Session, entity: Entity, rows: list[RequirementLegal] | None = None
) -> dict[int, dict]:
    """requirement_id -> effective legal status for this entity (jurisdiction by entity country; IR annex points
    become binding when the entity profile says IR 2024/2690 applies)."""
    profile = db.scalar(select(EntityProfile).where(EntityProfile.entity_id == entity.id))
    ir_applies = bool(profile and profile.ir_2024_2690_applicable)
    if rows is None:
        rows = list(db.scalars(select(RequirementLegal)))
    provs = {
        p.id: p
        for p in db.scalars(
            select(Provision).where(
                Provision.id.in_({r.basis_provision_id for r in rows if r.basis_provision_id})
            )
        )
    }
    by_req: dict[int, dict[str, RequirementLegal]] = defaultdict(dict)
    for r in rows:
        by_req[r.requirement_id][r.jurisdiction] = r
    out: dict[int, dict] = {}
    for rid, js in by_req.items():
        eu = js.get("EU")
        if ir_applies and eu and eu.status != "guidance":
            d = legal_row_dict(eu, provs.get(eu.basis_provision_id))
            d["status"] = "binding"
            d["note"] = "IR (EU) 2024/2690 applies to this entity (entity profile)."
            out[rid] = d
            continue
        r = js.get(entity.country or "")
        if r:
            out[rid] = legal_row_dict(r, provs.get(r.basis_provision_id))
    return out


# --------------------------------------------------------------------------- training status


def training_rule_for(db: Session, entity: Entity | None) -> TrainingRule | None:
    if not entity or not entity.country:
        return None
    return db.scalar(select(TrainingRule).where(TrainingRule.jurisdiction == entity.country))


def qualifying_date(t: TrainingRecord, rule: TrainingRule | None) -> date | None:
    if rule and rule.requires_certificate:
        return (t.cert_issued_on or t.training_date) if t.has_certificate else None
    return t.training_date


def member_training_status(
    member: BoardMember, rule: TrainingRule | None, trainings: list[TrainingRecord], today: date | None = None
) -> dict:
    today = today or date.today()
    mine = [t for t in trainings if member.id in (t.board_member_ids or [])]
    dates = [d for d in (qualifying_date(t, rule) for t in mine) if d]
    last = max(dates) if dates else None
    last_any = max((t.training_date for t in mine), default=None)
    if rule is None:
        return {"status": "no_rule", "last_training": last_any, "deadline": None, "trainings": len(mine)}
    start = member.appointed_at or (member.created_at.date() if member.created_at else today)
    if rule.count_from and start < rule.count_from:
        start = rule.count_from
    if last is None:
        deadline = add_months(start, rule.initial_months)
    elif rule.cadence_months:
        deadline = add_months(last, rule.cadence_months)
    else:
        deadline = None
    if last and deadline is None:
        status = "compliant"
    elif deadline and deadline < today:
        status = "overdue"
    elif last is None or (deadline and (deadline - today).days <= TRAINING_DUE_WINDOW_DAYS):
        status = "due"
    else:
        status = "compliant"
    return {
        "status": status,
        "last_training": last,
        "last_any_training": last_any,
        "deadline": deadline,
        "trainings": len(mine),
    }


def is_active_member(m: BoardMember, today: date | None = None) -> bool:
    return m.left_at is None or m.left_at > (today or date.today())


def sync_training_obligation(
    db: Session,
    member: BoardMember,
    trainings: list[TrainingRecord] | None = None,
    actor_id: int | None = None,
) -> Obligation | None:
    """Keep exactly one open 'training' obligation per active board member, due at the training deadline."""
    Ob = Obligation
    open_obs = list(
        db.scalars(
            select(Ob).where(
                Ob.source_type == "board_member",
                Ob.source_id == member.id,
                Ob.kind == "training",
                Ob.status == "open",
            )
        )
    )
    if not is_active_member(member):
        for o in open_obs:
            o.status = "cancelled"
            o.completion_note = "Member left the management body"
        return None
    if trainings is None:
        trainings = list(db.scalars(select(TrainingRecord)))
    rule = training_rule_for(db, db.get(Entity, member.entity_id))
    st = member_training_status(member, rule, trainings)
    if st["deadline"] is None:
        for o in open_obs:
            o.status = "done"
            o.completed_at = st["last_training"] or date.today()
            o.completed_by_id = actor_id
            o.completion_note = "Training requirement met"
        return None
    ob = open_obs[0] if open_obs else None
    for extra in open_obs[1:]:
        extra.status = "cancelled"
    if ob and st["last_training"] and ob.due_date != st["deadline"]:
        # a qualifying training was recorded: close the old occurrence, open the next one
        ob.status = "done"
        ob.completed_at = st["last_training"]
        ob.completed_by_id = actor_id
        ob.completion_note = "Training recorded"
        prev_id = ob.id
        ob = None
    else:
        prev_id = None
    title = f"Management training: {member.name}"
    owner = member.user_id if user_can_read_gov(db, member.user_id, member.entity_id) else None
    if ob is None:
        ob = Obligation(
            entity_id=member.entity_id,
            kind="training",
            title=title,
            recurrence="none",
            legal_ref=rule.legal_ref if rule else None,
            due_date=st["deadline"],
            source="board_member",
            source_type="board_member",
            source_id=member.id,
            owner_user_id=owner,
            previous_id=prev_id,
            description=(rule.label if rule else None),
        )
        db.add(ob)
    else:
        ob.due_date = st["deadline"]
        ob.title = title
        ob.owner_user_id = owner
    db.flush()
    return ob


# --------------------------------------------------------------------------- people


def governance_managers(db: Session, entity_id: int | None) -> list[int]:
    out = []
    for u in db.scalars(select(User).where(User.is_active.is_(True))):
        if build_principal(u).can_write("governance.manage", entity_id):
            out.append(u.id)
    return out
