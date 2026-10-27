"""Report drafts: the checklist items of a reporting stage, pre-filled from the incident record.

The authorities' portals (BSI-Portal, MijnNCSC, ENISA SRP, data protection authorities) take manual input; the draft
gives one text per required item to review and copy. Nothing is sent anywhere from here."""

from app.features.incident_reporting.criteria import STAGE_LABELS, stage_specs
from app.features.incident_reporting.models import ROOT_CAUSE_CATEGORIES, IncidentProfile, ReportTrack
from app.models import Incident, User

UNKNOWN = "Not yet known."


def _yes_no(v: bool | None, yes: str, no: str) -> str:
    return UNKNOWN if v is None else (yes if v else no)


def _join(*parts: str | None) -> str:
    return "\n\n".join(p.strip() for p in parts if p and p.strip()) or UNKNOWN


def _item_text(key: str, i: Incident, p: IncidentProfile | None, handler: User | None) -> str:
    cause = ROOT_CAUSE_CATEGORIES.get(p.root_cause_category or "", None) if p else None
    severity = f"Severity (internal rating): {i.severity}."
    texts = {
        "malicious": _yes_no(
            i.suspected_malicious,
            "Yes, unlawful or malicious acts are suspected.",
            "No indication of unlawful or malicious acts so far.",
        ),
        "cross_border": _yes_no(
            i.cross_border_impact,
            "Yes, the incident could have a cross-border impact.",
            "No cross-border impact is expected.",
        ),
        "contact": _join(f"{handler.display_name}, {handler.email}" if handler else None),
        "start_time": f"{i.detected_at:%d.%m.%Y %H:%M} UTC (detected)" if i.detected_at else UNKNOWN,
        "nature": _join(i.category and f"Category: {i.category}.", i.description, i.impact),
        "recovery": UNKNOWN,
        "measures": _join(i.measures),
        "update": _join(i.description, i.impact),
        "assessment": _join(severity, i.impact, i.significance_rationale),
        "ioc": _join(i.indicators_of_compromise),
        "status": _join(f"Status: {i.status}.", i.measures),
        "description": _join(i.description, severity, i.impact),
        "root_cause": _join(cause and f"Category: {cause}.", i.root_cause),
        "mitigation": _join(i.measures),
        "consequences": _join(i.impact),
        "dpo": UNKNOWN,
        "delay": "",
        "member_states": UNKNOWN,
        "sensitivity": UNKNOWN,
    }
    return texts.get(key, UNKNOWN)


def build_draft(
    i: Incident, t: ReportTrack, stage: str, p: IncidentProfile | None, handler: User | None
) -> dict:
    spec = stage_specs(t.regime, t.jurisdiction).get(stage)
    if spec is None:
        raise KeyError(stage)
    return {
        "track_id": t.id,
        "stage": stage,
        "stage_label": STAGE_LABELS.get(stage, stage),
        "authority": t.authority,
        "reference": t.reference,
        "entity": {"id": t.entity.id, "code": t.entity.code, "name": t.entity.name},
        "incident": {"id": i.id, "code": i.code, "title": i.title},
        "fields": [
            {"key": k, "label": label, "text": _item_text(k, i, p, handler)} for k, label in spec["items"]
        ],
    }
