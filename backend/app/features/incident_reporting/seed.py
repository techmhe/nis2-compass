"""Demo data: a significant incident at ATN (NL track), one at ATS (DE track plus GDPR) with partly submitted
stages, and a second credential incident at ATS so that the IR Art. 4 recurring-incident banner shows.
Idempotent: nothing happens when report tracks already exist. No reference data."""

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.util import next_code
from app.db import utcnow
from app.features.incident_reporting.criteria import default_authority, evaluate
from app.features.incident_reporting.models import (
    IncidentAssessment,
    IncidentProfile,
    ReportStage,
    ReportTrack,
)
from app.models import Entity, Incident, User
from app.services.indexing import index_object


def seed(db: Session, demo: bool) -> None:
    if not demo or db.scalar(select(func.count(ReportTrack.id))):
        return
    ents = {e.code: e for e in db.scalars(select(Entity))}
    users = {u.email: u for u in db.scalars(select(User))}
    isb = users.get("isb@demo.local")
    it = users.get("it@demo.local")
    nl = users.get("nl.contact@demo.local")
    if not (isb and it and "ATN" in ents and "ATS" in ents):
        return
    now = utcnow()

    def tl(at, text, who):
        return {"at": at.isoformat(), "text": text, "by": who.display_name}

    # --- ATN: ransomware on the production planning server (NL track, final report pending) ---------------------
    atn = ents["ATN"]
    aware = (now - timedelta(days=19)).replace(minute=40, second=0, microsecond=0)
    inc1 = Incident(
        code=next_code(db, Incident.code, "INC-"),
        entity_id=atn.id,
        title="Ransomware on the production planning server",
        description="Files on the MES/production planning server were encrypted. Production line 2 ran on manual "
        "planning for two shifts; the OT network was not affected.",
        category="Ransomware",
        severity="High",
        status="Contained",
        detected_at=aware - timedelta(minutes=35),
        aware_at=aware,
        suspected_malicious=True,
        cross_border_impact=False,
        handler_id=(nl or it).id,
        impact="Production planning unavailable for 16 hours, two shifts on manual planning, delivery delays for 3 customers.",
        indicators_of_compromise="Encrypted files with extension .lockbit3; C2 traffic to 185.220.101.0/24",
        root_cause="Initial access via an unpatched VPN appliance (vendor advisory from July 2026).",
        measures="Server isolated and rebuilt from backup; VPN appliance patched; credentials rotated.",
        timeline=[
            tl(aware - timedelta(minutes=35), "Encryption detected by EDR on the planning server", nl or it),
            tl(aware, "Incident confirmed by Local IT, crisis team informed", nl or it),
        ],
    )
    db.add(inc1)
    db.flush()
    db.add(
        IncidentProfile(
            incident_id=inc1.id,
            affected_entity_ids=[atn.id],
            root_cause_category="malware",
            financial_loss_eur=180_000,
            personal_data_breach=False,
            product_affected=False,
        )
    )
    answers1 = {
        "cbw_25_2_a": "yes",
        "cbw_25_2_b": "no",
        "ezk_7_1_a": "no",
        "ezk_7_1_b": "no",
        "ezk_12_a": "no",
        "ezk_12_b": "no",
        "ezk_12_c": "yes",
        "ezk_12_d": "no",
        "ezk_12_e": "no",
        "ezk_7_3": "no",
    }
    sugg1, _ = evaluate("NL", "ezk_manufacturing", answers1)
    db.add(
        IncidentAssessment(
            incident_id=inc1.id,
            entity_id=atn.id,
            jurisdiction="NL",
            sector_profile="ezk_manufacturing",
            answers=answers1,
            suggested_result=sugg1,
            result=sugg1,
            rationale="Production planning of line 2 unavailable for two shifts; continuity of the "
            "production process was endangered.",
            decided_by_id=isb.id,
            decided_at=aware + timedelta(hours=3),
        )
    )
    inc1.is_significant = True
    inc1.significance_rationale = (
        "ATN (NL): significant – Cbw Art. 25 lid 2, onderdeel a, Regeling cyberbeveiliging "
        "EZK Art. 12(c). Production planning of line 2 unavailable for two shifts."
    )
    t1 = ReportTrack(
        incident_id=inc1.id,
        entity_id=atn.id,
        regime="nis2",
        jurisdiction="NL",
        authority="NCSC-NL and RDI via MijnNCSC",
        reference="NCSC-2026-004871",
    )
    db.add(t1)
    db.flush()
    ew = aware + timedelta(hours=20)
    nt = aware + timedelta(hours=66)
    db.add(
        ReportStage(
            track_id=t1.id,
            stage="early_warning",
            submitted_at=ew,
            submitted_by_id=(nl or isb).id,
            reference="NCSC-2026-004871",
            checklist={
                "malicious": True,
                "cross_border": True,
                "contact": True,
                "start_time": True,
                "nature": True,
                "recovery": True,
                "measures": False,
            },
            note="Submitted via MijnNCSC; recovery forecast 24 h.",
        )
    )
    db.add(
        ReportStage(
            track_id=t1.id,
            stage="notification",
            submitted_at=nt,
            submitted_by_id=isb.id,
            reference="NCSC-2026-004871",
            checklist={"update": True, "assessment": True, "ioc": True, "cross_border": True},
        )
    )
    inc1.early_warning_at, inc1.notification_at = ew, nt
    inc1.authority, inc1.authority_reference = t1.authority, t1.reference
    inc1.timeline = [
        *inc1.timeline,
        tl(aware + timedelta(hours=3), "Significance assessed for ATN (NL): significant", isb),
        tl(
            ew,
            "Early warning submitted for ATN to NCSC-NL and RDI via MijnNCSC (reference NCSC-2026-004871)",
            nl or isb,
        ),
        tl(nt, "Incident notification submitted for ATN to NCSC-NL and RDI via MijnNCSC", isb),
    ]

    # --- ATS: earlier phishing with a compromised mailbox (not significant, same root cause category) -------------
    ats = ents["ATS"]
    earlier = (now - timedelta(days=64)).replace(minute=10, second=0, microsecond=0)
    inc0 = Incident(
        code=next_code(db, Incident.code, "INC-"),
        entity_id=ats.id,
        title="Compromised mailbox after phishing e-mail",
        description="An employee entered credentials on a fake login page; the mailbox sent internal phishing e-mails.",
        category="Account compromise",
        severity="Medium",
        status="Closed",
        is_significant=False,
        significance_rationale="ATS (DE): not significant – no disruption, damage below the thresholds.",
        detected_at=earlier,
        aware_at=earlier + timedelta(minutes=20),
        suspected_malicious=True,
        handler_id=it.id,
        measures="Password reset, sessions revoked, mailbox rules removed.",
        timeline=[tl(earlier, "Suspicious mailbox rules reported by a colleague", it)],
    )
    db.add(inc0)
    db.flush()
    db.add(
        IncidentProfile(
            incident_id=inc0.id,
            affected_entity_ids=[ats.id],
            root_cause_category="credential_compromise",
            financial_loss_eur=12_000,
            handled_at=earlier + timedelta(days=2),
        )
    )
    answers0 = {
        "ir_3_1_a": "no",
        "ir_3_1_b": "no",
        "ir_3_1_c": "no",
        "ir_3_1_d": "no",
        "ir_3_1_e": "no",
        "ir_art4": "no",
        "bsig_2_11_a": "no",
        "bsig_2_11_b": "no",
        "ir_3_2": "no",
    }
    s0, _ = evaluate("DE", "default", answers0)
    db.add(
        IncidentAssessment(
            incident_id=inc0.id,
            entity_id=ats.id,
            jurisdiction="DE",
            sector_profile="default",
            answers=answers0,
            suggested_result=s0,
            result=s0,
            rationale="No disruption, damage below the thresholds.",
            decided_by_id=isb.id,
            decided_at=earlier + timedelta(hours=2),
        )
    )

    # --- ATS: VPN account compromise (DE track: early warning sent, notification due; GDPR track open) ------------
    aware2 = (now - timedelta(hours=30)).replace(second=0, microsecond=0)
    inc2 = Incident(
        code=next_code(db, Incident.code, "INC-"),
        entity_id=ats.id,
        title="Compromised VPN account used to access engineering file shares",
        description="A VPN account of an external engineer was used from an unknown IP address to copy files from the "
        "engineering share, including customer drawings and an HR export.",
        category="Unauthorised access",
        severity="Critical",
        status="Open",
        detected_at=aware2 - timedelta(hours=1),
        aware_at=aware2,
        suspected_malicious=True,
        cross_border_impact=None,
        handler_id=it.id,
        impact="Engineering share and one HR export affected; production not affected.",
        timeline=[
            tl(aware2 - timedelta(hours=1), "SIEM alert: impossible travel for VPN account ext-eng-07", it),
            tl(aware2, "Access confirmed as unauthorised, account disabled", it),
        ],
    )
    db.add(inc2)
    db.flush()
    db.add(
        IncidentProfile(
            incident_id=inc2.id,
            affected_entity_ids=[ats.id],
            root_cause_category="credential_compromise",
            financial_loss_eur=None,
            personal_data_breach=True,
            product_affected=False,
        )
    )
    answers2 = {
        "ir_3_1_a": "unknown",
        "ir_3_1_b": "yes",
        "ir_3_1_c": "no",
        "ir_3_1_d": "no",
        "ir_3_1_e": "yes",
        "ir_art4": "no",
        "bsig_2_11_a": "unknown",
        "bsig_2_11_b": "yes",
        "ir_3_2": "no",
    }
    s2, _ = evaluate("DE", "default", answers2)
    db.add(
        IncidentAssessment(
            incident_id=inc2.id,
            entity_id=ats.id,
            jurisdiction="DE",
            sector_profile="default",
            answers=answers2,
            suggested_result=s2,
            result=s2,
            rationale="Customer drawings (trade secrets) were copied by an unauthorised party.",
            decided_by_id=isb.id,
            decided_at=aware2 + timedelta(hours=2),
        )
    )
    inc2.is_significant = True
    inc2.significance_rationale = (
        "ATS (DE): significant – IR 2024/2690 Art. 3(1)(b), IR 2024/2690 Art. 3(1)(e), "
        "§ 2 Nr. 11 Buchst. b BSIG. Customer drawings were copied by an unauthorised party."
    )
    t2 = ReportTrack(
        incident_id=inc2.id,
        entity_id=ats.id,
        regime="nis2",
        jurisdiction="DE",
        authority=default_authority("nis2", ats),
        reference="BSI-MIP-2026-11873",
    )
    t3 = ReportTrack(
        incident_id=inc2.id,
        entity_id=ats.id,
        regime="gdpr",
        jurisdiction="DE",
        authority="Data protection supervisory authority (Land)",
    )
    db.add_all([t2, t3])
    db.flush()
    ew2 = aware2 + timedelta(hours=17)
    db.add(
        ReportStage(
            track_id=t2.id,
            stage="early_warning",
            submitted_at=ew2,
            submitted_by_id=isb.id,
            reference="BSI-MIP-2026-11873",
            checklist={"malicious": True, "cross_border": True},
            note="Submitted in the BSI-Portal.",
        )
    )
    db.add(
        ReportStage(
            track_id=t2.id,
            stage="notification",
            checklist={"update": True, "assessment": False, "ioc": True},
            note="Draft prepared; waiting for the forensic scope.",
        )
    )
    inc2.early_warning_at = ew2
    inc2.authority, inc2.authority_reference = t2.authority, t2.reference
    inc2.timeline = [
        *inc2.timeline,
        tl(aware2 + timedelta(hours=2), "Significance assessed for ATS (DE): significant", isb),
        tl(aware2 + timedelta(hours=2), "Reporting track opened: ATS to BSI", isb),
        tl(ew2, "Early warning submitted for ATS to the BSI (reference BSI-MIP-2026-11873)", isb),
    ]
    db.commit()
    for i in (inc0, inc1, inc2):
        index_object(db, "incident", i.id, commit=False)
    db.commit()

    # the controls KPIs depend on incidents: recompute them now that the demo incidents exist
    try:
        from app.features.controls.kpi import refresh_computed

        refresh_computed(db)
        db.commit()
    except ImportError:  # controls module not installed
        pass
