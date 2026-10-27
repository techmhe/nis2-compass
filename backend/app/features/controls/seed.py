"""Reference data (recurring control activities, KPI catalogue) and demo data (past occurrences with mixed
results, exceptions, KPI history). Idempotent: does nothing when control activities already exist."""

import random
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import app.features.controls.hooks  # noqa: F401  (search sources for indexing)
from app.db import utcnow
from app.features.controls.kpi import (
    COMPUTATIONS,
    compute,
    ensure_instances,
    recent_periods,
    refresh_computed,
    upsert_value,
)
from app.features.controls.models import (
    ControlActivity,
    ControlException,
    ControlOccurrence,
    MetricDefinition,
    MetricInstance,
)
from app.features.controls.schedule import add_months, generate_occurrences, periods, scope_entity_ids
from app.models import (
    ActionItem,
    AssessmentRound,
    Document,
    DocumentLink,
    Entity,
    Requirement,
    Stakeholder,
    User,
)
from app.services.indexing import index_object

# code, title, description, requirement numbers, legal refs, recurrence, anchor month, owner stakeholder,
# owner user (demo), required evidence, validity days, entity codes (None = all)
ACTIVITIES = [
    (
        "Quarterly review of user access rights",
        "Entity IT reviews all user accounts and their access rights against HR records and role profiles; removes "
        "leavers and excess rights.",
        ["11.2.3", "11.5.4"],
        "IR 11.2.3, 11.5.4; Cbb Art. 15(3); § 30(2) Nr. 9 BSIG",
        "quarterly",
        3,
        "IT Coordinator",
        "it@demo.local",
        "Signed review list per system (export of accounts with reviewer decisions) and the ticket numbers of removals.",
        120,
        None,
    ),
    (
        "Quarterly review of privileged and administrator accounts",
        "Review of domain admins, local admins, service accounts and OT engineering accounts incl. break-glass accounts.",
        ["11.3.3", "11.3.2"],
        "IR 11.3.3; Cbb Art. 15(3)",
        "quarterly",
        2,
        "Central IT",
        "it@demo.local",
        "Export of privileged group memberships with reviewer sign-off.",
        120,
        None,
    ),
    (
        "Backup restore test",
        "Restore of a representative sample (file server, ERP database, one OT project archive) into the isolated "
        "test environment; restore time compared with the RTO.",
        ["4.2.6", "4.2.3"],
        "IR 4.2.6, 4.2.3; Cbb Art. 9(2)",
        "semi_annual",
        5,
        "Local IT / MSP",
        "it@demo.local",
        "Restore test protocol with scope, duration, integrity check result and deviations.",
        200,
        None,
    ),
    (
        "Annual review of the information security policy",
        "Management reviews the information security policy and topic-specific policies and records the approval.",
        ["1.1.2", "1.2.6"],
        "IR 1.1.2; Cbw Art. 24(1); § 38(1) BSIG",
        "annual",
        3,
        "Information Security Officer",
        "isb@demo.local",
        "Approved policy version with the date of the management decision.",
        400,
        None,
    ),
    (
        "Annual security awareness training",
        "All staff complete the awareness module; designated roles complete their role-based training.",
        ["8.1.2", "8.2.2", "8.2.5"],
        "IR 8.1, 8.2; Cbb Art. 12; § 30(2) Nr. 7 BSIG",
        "annual",
        11,
        "Information Security Officer",
        "isb@demo.local",
        "LMS completion report per entity (participants, completion rate).",
        400,
        None,
    ),
    (
        "Monthly review of vulnerability scan results",
        "Review of the internal and external scan results; critical findings get a ticket and a due date.",
        ["6.10.2", "6.10.1"],
        "IR 6.10; Cbb Art. 17",
        "monthly",
        1,
        "Central IT",
        "it@demo.local",
        "Scan summary report and the list of opened remediation tickets.",
        45,
        None,
    ),
    (
        "Business continuity and crisis exercise",
        "Tabletop or functional exercise of the business continuity and crisis plan with management participation.",
        ["4.1.4", "4.3.4"],
        "IR 4.1.4, 4.3.4; Cbb Art. 9(3)-(5); § 30(2) Nr. 3 BSIG",
        "annual",
        10,
        "Information Security Officer",
        "isb@demo.local",
        "Exercise report with lessons learned and follow-up actions.",
        400,
        None,
    ),
    (
        "Annual supplier security review",
        "Review of critical suppliers: certificates, contract clauses, questionnaire results and incidents.",
        ["5.1.6", "5.2"],
        "IR 5.1.6, 5.2; Cbb Art. 10(2); § 30(2) Nr. 4 BSIG",
        "annual",
        6,
        "IT Procurement",
        None,
        "Updated supplier directory and review record per critical supplier.",
        400,
        None,
    ),
    (
        "Monthly security log review",
        "Review of SIEM alerts, failed logons, admin activity and firewall denies for unusual trends.",
        ["3.2.4", "3.2.1"],
        "IR 3.2.4",
        "monthly",
        1,
        "Local IT / MSP",
        "it@demo.local",
        "Log review record with observations and escalations.",
        45,
        None,
    ),
    (
        "Annual review of the risk assessment",
        "Risk owners review the risk assessment and the risk treatment plan; residual risks are accepted by management.",
        ["2.1.4", "2.1.3"],
        "IR 2.1.4; Cbb Art. 7; § 30(2) Nr. 1 BSIG",
        "annual",
        9,
        "Information Security Officer",
        "isb@demo.local",
        "Updated risk register and the management acceptance of residual risks.",
        400,
        None,
    ),
    (
        "Firewall rule review",
        "Review of perimeter and IT/OT boundary firewall rules; unused and overly broad rules are removed.",
        ["6.7.3", "6.8.3"],
        "IR 6.7.3, 6.8.3",
        "semi_annual",
        6,
        "Local IT / MSP",
        "it@demo.local",
        "Rule review export with decisions and change tickets.",
        200,
        None,
    ),
    (
        "Annual asset inventory review",
        "Asset owners confirm completeness and classification of the IT and OT asset inventory.",
        ["12.4.3", "12.1.3"],
        "IR 12.4.3; Cbb Art. 16(4)",
        "annual",
        4,
        "IT Coordinator",
        "it@demo.local",
        "Signed inventory review with the list of changes.",
        400,
        None,
    ),
    (
        "Phishing simulation",
        "Simulated phishing campaign for all staff with targeted follow-up training for clickers.",
        ["8.1.3"],
        "IR 8.1.3",
        "quarterly",
        2,
        "Information Security Officer",
        "isb@demo.local",
        "Campaign report with click and report rates per entity.",
        120,
        None,
    ),
    (
        "Incident response and reporting test",
        "Walk-through of the incident response plan including the 24 h / 72 h reporting chain to BSI or NCSC.",
        ["3.5.5", "14.1", "14.4"],
        "IR 3.5.5; § 32 BSIG; Cbw Art. 26-29",
        "annual",
        8,
        "Information Security Officer",
        "isb@demo.local",
        "Test report incl. the reporting drill timings.",
        400,
        None,
    ),
    (
        "Annual effectiveness evaluation of security measures",
        "Written evaluation of the effectiveness of the measures based on KPIs, control results and incidents; "
        "presented to management.",
        ["7.1", "7.3", "2.2.1"],
        "IR 7; Cbb Art. 18; § 30(2) Nr. 6 BSIG",
        "annual",
        12,
        "Information Security Officer",
        "isb@demo.local",
        "Effectiveness report approved by management.",
        400,
        None,
    ),
    (
        "Review of OT remote access",
        "Review of supplier and maintenance remote access paths to OT, active accounts and session logs.",
        ["17.3"],
        "§ 30(2) Nr. 9 BSIG; Cbb Art. 15",
        "semi_annual",
        6,
        "OT",
        "it@demo.local",
        "List of remote access accounts with approvals and a sample of session logs.",
        200,
        None,
    ),
]

# code, name, unit, direction, description, legal refs, target, frequency, computation
KPIS = [
    (
        "COV",
        "Assessment coverage",
        "%",
        "higher",
        "Share of in-scope requirements assessed in the current round.",
        "§ 30(1) BSIG documentation duty",
        100,
        "monthly",
        "assessment_coverage",
    ),
    (
        "SCORE",
        "Average compliance score",
        "%",
        "higher",
        "Average answer score in the current assessment round.",
        "IR 7.1; Cbb Art. 18",
        75,
        "monthly",
        "average_score",
    ),
    (
        "AP-OVERDUE",
        "Overdue action plan items",
        "count",
        "lower",
        "Action plan items past their target date.",
        "IR 2.2; Cbb Art. 18",
        0,
        "monthly",
        "overdue_actions",
    ),
    (
        "CTL-ONTIME",
        "Controls performed on time",
        "%",
        "higher",
        "Control occurrences due in the period that were performed by their due date.",
        "IR 2.2.3, 7; Cbb Art. 18",
        90,
        "monthly",
        "controls_on_time",
    ),
    (
        "INC-COUNT",
        "Incidents per quarter",
        "count",
        "lower",
        "Incidents recorded in the quarter (by time of awareness).",
        "IR 3; § 30(2) Nr. 2 BSIG",
        None,
        "quarterly",
        "incident_count",
    ),
    (
        "MTTEW",
        "Mean time to early warning",
        "hours",
        "lower",
        "Mean hours from becoming aware of a significant incident to the NIS-2 early warning.",
        "§ 32(1) Nr. 1 BSIG; Cbw Art. 26",
        24,
        "quarterly",
        "mean_time_to_early_warning",
    ),
    (
        "DOC-REVIEW",
        "Documents past review date",
        "%",
        "lower",
        "Share of documents with a review date that are past it.",
        "IR 1.1.2; Cbb Art. 6",
        5,
        "monthly",
        "docs_past_review",
    ),
    (
        "MFA",
        "MFA coverage of user accounts",
        "%",
        "higher",
        "User accounts protected by multi-factor authentication.",
        "IR 11.7; § 30(2) Nr. 10 BSIG",
        100,
        "quarterly",
        None,
    ),
    (
        "PATCH-DAYS",
        "Critical patch latency",
        "days",
        "lower",
        "Median days from release to installation of critical security patches.",
        "IR 6.6",
        14,
        "monthly",
        None,
    ),
    (
        "VULN-CRIT",
        "Open critical vulnerabilities",
        "count",
        "lower",
        "Critical vulnerabilities open for more than 30 days at period end.",
        "IR 6.10; Cbb Art. 17",
        0,
        "monthly",
        None,
    ),
    (
        "RESTORE",
        "Restore test success rate",
        "%",
        "higher",
        "Restore tests completed within RTO and without data loss.",
        "IR 4.2.6; Cbb Art. 9(2)",
        100,
        "quarterly",
        None,
    ),
    (
        "PHISH",
        "Phishing simulation click rate",
        "%",
        "lower",
        "Share of recipients clicking in the phishing simulation.",
        "IR 8.1.3",
        5,
        "quarterly",
        None,
    ),
    (
        "TRAIN",
        "Awareness training completion",
        "%",
        "higher",
        "Staff who completed the annual awareness training.",
        "IR 8.1, 8.2; Cbb Art. 12; § 30(2) Nr. 7 BSIG",
        95,
        "quarterly",
        None,
    ),
    (
        "SUP-ASSESS",
        "Critical supplier assessment coverage",
        "%",
        "higher",
        "Critical suppliers with a current security assessment.",
        "IR 5.1.6; Cbb Art. 10(2)",
        100,
        "quarterly",
        None,
    ),
    (
        "MTTD",
        "Mean time to detect",
        "hours",
        "lower",
        "Mean hours from start of an incident to its detection.",
        "BSI guiding questions for management",
        24,
        "quarterly",
        None,
    ),
]

# demo manual KPI series: code -> {entity code: (start value, end value)} over the last periods
MANUAL_SERIES = {
    "MFA": {"ATL": (82, 97), "ATS": (70, 91), "ATN": (55, 84), "ATC": (40, 66)},
    "PATCH-DAYS": {"ATL": (31, 12), "ATS": (35, 18), "ATN": (42, 21), "ATC": (48, 30)},
    "VULN-CRIT": {"ATL": (9, 1), "ATS": (12, 3), "ATN": (15, 4), "ATC": (11, 6)},
    "RESTORE": {"ATL": (75, 100), "ATS": (50, 100), "ATN": (50, 75), "ATC": (0, 50)},
    "PHISH": {"ATL": (14, 4.5), "ATS": (17, 6.2), "ATN": (19, 7.8), "ATC": (22, 11)},
    "TRAIN": {"ATL": (61, 96), "ATS": (55, 92), "ATN": (48, 88), "ATC": (35, 71)},
    "SUP-ASSESS": {"ATL": (20, 80), "ATS": (10, 60), "ATN": (0, 50), "ATC": (0, 25)},
    "MTTD": {"ATL": (40, 18), "ATS": (52, 22), "ATN": (60, 30), "ATC": (72, 44)},
}
MANUAL_OWNERS = {
    "MFA": "it@demo.local",
    "PATCH-DAYS": "it@demo.local",
    "VULN-CRIT": "it@demo.local",
    "RESTORE": "it@demo.local",
    "PHISH": "isb@demo.local",
    "TRAIN": "isb@demo.local",
    "SUP-ASSESS": "isb@demo.local",
    "MTTD": "it@demo.local",
}
SNAPSHOT_HISTORY = {
    "COV": (0.35, 1.0),
    "SCORE": (0.55, 1.0),
    "AP-OVERDUE": (2.5, 1.0),
    "DOC-REVIEW": (3.0, 1.0),
}


def seed(db: Session, demo: bool) -> None:
    if db.scalar(select(func.count(ControlActivity.id))):
        return
    reqs = {r.number: r.id for r in db.scalars(select(Requirement))}
    stakeholders = {s.name: s.id for s in db.scalars(select(Stakeholder))}
    users = {u.email: u.id for u in db.scalars(select(User))}
    ents = {e.code: e.id for e in db.scalars(select(Entity))}
    acts: list[ControlActivity] = []
    for n, (
        title,
        desc,
        numbers,
        legal,
        rec,
        anchor,
        owner_st,
        owner_user,
        evidence,
        validity,
        scope,
    ) in enumerate(ACTIVITIES, 1):
        a = ControlActivity(
            code=f"CA-{n:03d}",
            title=title,
            description=desc,
            requirement_ids=[reqs[x] for x in numbers if x in reqs],
            legal_refs=legal,
            entity_scope="list" if scope else "all",
            entity_ids=[ents[c] for c in (scope or []) if c in ents],
            recurrence=rec,
            anchor_month=anchor,
            owner_stakeholder_id=stakeholders.get(owner_st),
            owner_user_id=users.get(owner_user) if demo and owner_user else None,
            required_evidence=evidence,
            evidence_validity_days=validity,
            active=True,
        )
        if a.entity_scope == "list" and not a.entity_ids:
            a.entity_scope = "all"
        db.add(a)
        acts.append(a)
    db.flush()
    for a in acts:
        generate_occurrences(db, a)

    defs: list[MetricDefinition] = []
    for n, (code, name, unit, direction, desc, legal, target, freq, comp) in enumerate(KPIS):
        d = MetricDefinition(
            code=code,
            name=name,
            unit=unit,
            direction=direction,
            description=desc,
            legal_refs=legal,
            default_target=target,
            frequency=freq,
            computation=comp,
            active=True,
            sort_order=n,
        )
        db.add(d)
        defs.append(d)
    db.flush()
    for d in defs:
        ensure_instances(db, d)
    db.commit()

    if demo:
        _demo_occurrences(db, acts, users)
        _demo_exceptions(db, users, ents, reqs, acts)
        _demo_kpis(db, defs, users)
    refresh_computed(db)
    db.commit()
    for a in acts:
        index_object(db, "control_activity", a.id, commit=False)
    for x in db.scalars(select(ControlException)):
        index_object(db, "control_exception", x.id, commit=False)
    db.commit()


def _demo_occurrences(db: Session, acts: list[ControlActivity], users: dict[str, int]) -> None:
    rnd = random.Random(20260929)
    today = utcnow().date()
    start = add_months(today, -18)
    ents = {e.id: e for e in db.scalars(select(Entity))}
    rnd_id = db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
    evidence_docs = {d.title: d for d in db.scalars(select(Document))}
    performers = [users.get("it@demo.local"), users.get("isb@demo.local"), users.get("nl.contact@demo.local")]
    ap_no = None
    for a in acts:
        for p in periods(a, start, today - timedelta(days=1)):
            for eid in scope_entity_ids(db, a):
                ent = ents[eid]
                age_days = (today - p.due).days
                o = ControlOccurrence(
                    activity_id=a.id,
                    entity_id=eid,
                    period_key=p.key,
                    period_label=p.label,
                    due_date=p.due,
                    status="planned",
                )
                roll = rnd.random()
                recent = age_days < 45
                if recent and roll < 0.22:
                    pass  # still open -> overdue
                elif roll < 0.05 and not recent:
                    o.status = "skipped"
                    o.notes = (
                        "Postponed to the next period: system migration in progress (approved by the ISO)."
                    )
                else:
                    o.status = "done"
                    late = rnd.random() < 0.18
                    o.performed_at = (
                        p.due + timedelta(days=rnd.randint(1, 20))
                        if late
                        else p.due - timedelta(days=rnd.randint(0, 12))
                    )
                    o.performed_at = min(o.performed_at, today - timedelta(days=1))
                    o.performed_by_id = (
                        performers[2]
                        if ent.country == "NL" and performers[2]
                        else performers[rnd.randint(0, 1)]
                    )
                    r = rnd.random()
                    o.result = (
                        "effective" if r < 0.85 else ("partially_effective" if r < 0.975 else "not_effective")
                    )
                    o.notes = {
                        "effective": "Performed as planned, no deviations.",
                        "partially_effective": "Performed; minor deviations found and corrected within the period.",
                        "not_effective": "Significant deviations found; see the linked action plan item.",
                    }[o.result]
                db.add(o)
                db.flush()
                if o.result == "not_effective" and a.requirement_ids:
                    if ap_no is None:
                        codes = db.scalars(select(ActionItem.code).where(ActionItem.code.like("AP-%"))).all()
                        ap_no = max([int(c[3:]) for c in codes if c[3:].isdigit()] or [0])
                    ap_no += 1
                    item = ActionItem(
                        code=f"AP-{ap_no:03d}",
                        round_id=rnd_id,
                        entity_id=eid,
                        requirement_id=a.requirement_ids[0],
                        priority="High",
                        title=f"Control {a.code} not effective ({p.label}): {a.title}",
                        status="In Progress" if age_days > 60 else "Not Started",
                        responsible_id=a.owner_stakeholder_id,
                        target_date=o.performed_at + timedelta(days=45),
                        acceptance_criterion=f"Control {a.code} performed again with the result effective",
                        expected_evidence=a.required_evidence,
                        comments=f"Created from control occurrence {a.code} {ent.code} {p.label}.",
                    )
                    db.add(item)
                    db.flush()
                    o.action_item_id = item.id
                    index_object(db, "action_item", item.id, commit=False)
                if o.status == "done" and o.result == "effective":
                    doc = None
                    if a.code == "CA-004":
                        doc = evidence_docs.get("Information Security Policy")
                    elif a.code == "CA-003":
                        doc = evidence_docs.get("Backup and Recovery Guideline")
                    elif a.code in ("CA-001", "CA-002"):
                        doc = evidence_docs.get("Access Control Policy")
                    if doc and (doc.entity_id in (None, eid)):
                        db.add(
                            DocumentLink(
                                document_id=doc.id,
                                target_type="control_occurrence",
                                target_id=o.id,
                                note="Reference document for this control",
                                created_by_id=o.performed_by_id,
                            )
                        )
    db.commit()


def _demo_exceptions(
    db: Session,
    users: dict[str, int],
    ents: dict[str, int],
    reqs: dict[str, int],
    acts: list[ControlActivity],
) -> None:
    today = utcnow().date()
    isb, it, pm = users.get("isb@demo.local"), users.get("it@demo.local"), users.get("pm@demo.local")
    fw = next((a.id for a in acts if a.code == "CA-011"), None)
    rows = [
        (
            "EX-001",
            "Legacy HMI workstations without multi-factor authentication",
            "requirement",
            "ATN",
            "11.7.1",
            None,
            "The HMI software of production line 2 does not support MFA; replacement is planned with the line retrofit.",
            "Workstations in an isolated OT zone, access only via the jump host with MFA, local accounts reviewed monthly.",
            it,
            isb,
            "approved",
            today + timedelta(days=150),
        ),
        (
            "EX-002",
            "Firewall rule review delivered by the managed service provider",
            "control",
            "ATC",
            None,
            fw,
            "The ATC firewall is operated by the MSP, which delivers a rule review report once a year only.",
            "MSP report reviewed by Local IT; change tickets for all rule changes; quarterly rule export.",
            pm,
            isb,
            "requested",
            today + timedelta(days=365),
        ),
        (
            "EX-003",
            "OT controllers without current security patches",
            "requirement",
            "ATL",
            "6.6.1",
            None,
            "Vendor has not released patches certified for the installed PLC firmware.",
            "Controllers in a separate zone, write access blocked from the office network, vendor bulletin monitoring.",
            it,
            isb,
            "approved",
            today + timedelta(days=10),
        ),
        (
            "EX-004",
            "Temporary use of USB media in the test laboratory",
            "entity",
            "ATS",
            "12.3.1",
            None,
            "Measurement devices in the lab only export results to USB media.",
            "Dedicated scanned media, kiosk scan before use.",
            it,
            isb,
            "approved",
            today - timedelta(days=21),
        ),
    ]
    for code, title, scope, ecode, rnum, act, reason, comp, requester, approver, status, expires in rows:
        if not (requester and approver):
            continue
        db.add(
            ControlException(
                code=code,
                title=title,
                scope_type=scope,
                entity_id=ents.get(ecode),
                requirement_id=reqs.get(rnum) if rnum else None,
                activity_id=act,
                reason=reason,
                compensating_measures=comp,
                requested_by_id=requester,
                approver_id=approver,
                status=status,
                decided_at=utcnow() - timedelta(days=40) if status == "approved" else None,
                decision_note="Accepted with the compensating measures listed."
                if status == "approved"
                else None,
                expires_at=expires,
            )
        )
    db.commit()


def _demo_kpis(db: Session, defs: list[MetricDefinition], users: dict[str, int]) -> None:
    today = utcnow().date()
    ents = {e.id: e.code for e in db.scalars(select(Entity))}
    for d in defs:
        insts = list(db.scalars(select(MetricInstance).where(MetricInstance.definition_id == d.id)))
        n = 6 if d.frequency == "monthly" else 5
        keys = recent_periods(d.frequency, today, n)
        if d.code in MANUAL_SERIES:
            owner = users.get(MANUAL_OWNERS.get(d.code, ""))
            series = MANUAL_SERIES[d.code]
            for inst in insts:
                code = ents.get(inst.entity_id)
                if code in ("ATN", "ATC"):
                    inst.owner_user_id = users.get("nl.contact@demo.local") or owner
                else:
                    inst.owner_user_id = owner
                # the current period is left open for data entry
                for i, k in enumerate(keys[:-1]):
                    t = i / max(1, len(keys) - 2)
                    if code is None:
                        vals = [a + (b - a) * t for a, b in series.values()]
                        v = sum(vals) / len(vals)
                    else:
                        a, b = series[code]
                        v = a + (b - a) * t
                    upsert_value(db, inst, k, round(v, 1), "manual", None, owner)
        elif d.computation and COMPUTATIONS[d.computation][2]:
            # snapshot metrics cannot be recomputed for the past: demo history leading up to today's value
            factor_start, _ = SNAPSHOT_HISTORY.get(d.code, (1.0, 1.0))
            for inst in insts:
                current = compute(db, d.computation, inst.entity_id, keys[-1])
                if current is None:
                    continue
                for i, k in enumerate(keys[:-1]):
                    t = i / max(1, len(keys) - 1)
                    v = current * (factor_start + (1 - factor_start) * t)
                    if d.unit == "%":
                        v = min(100.0, v)
                    upsert_value(
                        db,
                        inst,
                        k,
                        round(v, 1) if d.unit == "%" else float(round(v)),
                        "computed",
                        "Demo history",
                    )
        elif d.computation:
            for inst in insts:
                for k in keys[:-1]:
                    v = compute(db, d.computation, inst.entity_id, k)
                    if v is not None:
                        upsert_value(db, inst, k, v, "computed")
    db.commit()
