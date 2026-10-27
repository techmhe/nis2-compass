"""Significance criteria per jurisdiction and the content checklists of the report stages.

Sources (as of Sep 2026):
* IR (EU) 2024/2690 Art. 3(1), 3(2) and 4 (regulations library code IR2024/2690).
* BSI, #nis2know NIS-2-Meldepflicht: for sectors other than the digital ones the BSI regards the IR Art. 3(1)
  criteria as a sufficient indication that an incident is significant.
* § 2 Nr. 11 BSIG (definition "erheblicher Sicherheitsvorfall"), § 32 BSIG (reporting stages).
* Cbw Art. 25(2) (definition "significant incident"), Art. 26-29 (stages); Cbb Art. 24 (early-warning content).
* Regeling cyberbeveiliging EZK (Stcrt., in force 15 Aug 2026, BWBR0052884) Art. 7 (general criteria for the
  EZK sectors) and Art. 12 (manufacturing); not part of the regulations library, cited by URL.
* GDPR Art. 33; Cyber Resilience Act (EU) 2024/2847 Art. 14.
Criteria texts are close English renderings; the legal texts are authoritative.
"""

from app.core.jurisdictions import get_jurisdiction

EZK_URL = "https://wetten.overheid.nl/BWBR0052884/2026-08-15/0"
BSI_URL = (
    "https://www.bsi.bund.de/DE/Themen/Regulierte-Wirtschaft/NIS-2-regulierte-Unternehmen/NIS-2-Infopakete/"
    "NIS-2-Meldepflicht/NIS-2-Meldepflicht_node.html"
)
GDPR_URL = "https://eur-lex.europa.eu/eli/reg/2016/679/oj"
CRA_URL = "https://eur-lex.europa.eu/eli/reg/2024/2847/oj"


def _lib(code: str, key: str, label: str) -> dict:
    """Reference into the regulations library (resolved by the frontend via regulation code + provision key)."""
    return {"code": code, "key": key, "label": label, "url": None}


def _url(url: str, label: str) -> dict:
    return {"code": None, "key": None, "label": label, "url": url}


# --- significance criteria ------------------------------------------------------------------------------------

SECTOR_PROFILES = {
    "DE": [{"key": "default", "label": "All sectors (important and particularly important entities)"}],
    "NL": [
        {"key": "ezk_manufacturing", "label": "Manufacturing (vervaardiging), Regeling cyberbeveiliging EZK"},
        {"key": "other", "label": "Other sector (sector regulation of the responsible ministry)"},
    ],
}

CRITERIA: dict[str, list[dict]] = {
    "DE": [
        {
            "key": "ir_art3",
            "title": "Thresholds of IR (EU) 2024/2690 Art. 3(1)",
            "intro": "The BSI regards each of these criteria as a sufficient indication that an incident is significant, "
            "also for sectors outside the digital ones covered by the Implementing Regulation.",
            "source": _url(BSI_URL, "BSI, NIS-2-Meldepflicht"),
            "profiles": ["default"],
            "criteria": [
                {
                    "key": "ir_3_1_a",
                    "kind": "criterion",
                    "label": "Financial loss above the threshold",
                    "detail": "The incident has caused or is capable of causing direct financial loss for the entity that "
                    "exceeds EUR 500,000 or 5 % of its total annual turnover in the preceding financial year, "
                    "whichever is lower.",
                    "ref": _lib("IR2024/2690", "3.1.a", "IR 2024/2690 Art. 3(1)(a)"),
                    "uses_threshold": True,
                },
                {
                    "key": "ir_3_1_b",
                    "kind": "criterion",
                    "label": "Exfiltration of trade secrets",
                    "detail": "The incident has caused or is capable of causing the exfiltration of trade secrets within the "
                    "meaning of Art. 2(1) of Directive (EU) 2016/943.",
                    "ref": _lib("IR2024/2690", "3.1.b", "IR 2024/2690 Art. 3(1)(b)"),
                },
                {
                    "key": "ir_3_1_c",
                    "kind": "criterion",
                    "label": "Death of a natural person",
                    "detail": "The incident has caused or is capable of causing the death of a natural person.",
                    "ref": _lib("IR2024/2690", "3.1.c", "IR 2024/2690 Art. 3(1)(c)"),
                },
                {
                    "key": "ir_3_1_d",
                    "kind": "criterion",
                    "label": "Considerable damage to health",
                    "detail": "The incident has caused or is capable of causing considerable damage to a natural person's health.",
                    "ref": _lib("IR2024/2690", "3.1.d", "IR 2024/2690 Art. 3(1)(d)"),
                },
                {
                    "key": "ir_3_1_e",
                    "kind": "criterion",
                    "label": "Malicious unauthorised access",
                    "detail": "A successful, suspectedly malicious and unauthorised access to network and information systems "
                    "occurred which is capable of causing severe operational disruption.",
                    "ref": _lib("IR2024/2690", "3.1.e", "IR 2024/2690 Art. 3(1)(e)"),
                },
                {
                    "key": "ir_art4",
                    "kind": "criterion",
                    "label": "Recurring incidents",
                    "detail": "Together with other incidents that individually were not significant, the incident occurred at "
                    "least twice within 6 months, with the same apparent root cause, and the incidents jointly meet "
                    "the financial-loss criterion of Art. 3(1)(a).",
                    "ref": _lib("IR2024/2690", "4", "IR 2024/2690 Art. 3(1)(f), Art. 4"),
                    "uses_recurring": True,
                },
            ],
        },
        {
            "key": "bsig",
            "title": "Definition in § 2 Nr. 11 BSIG",
            "intro": "An incident is significant (erheblicher Sicherheitsvorfall) if it meets either limb of the statutory "
            "definition. This general definition applies regardless of the thresholds above.",
            "source": _lib("BSIG", "2.11", "§ 2 Nr. 11 BSIG"),
            "profiles": ["default"],
            "criteria": [
                {
                    "key": "bsig_2_11_a",
                    "kind": "criterion",
                    "label": "Severe operational disruption or financial loss",
                    "detail": "The incident has caused or can cause severe operational disruption of the services or "
                    "financial losses for the entity.",
                    "ref": _lib("BSIG", "2.11.a", "§ 2 Nr. 11 Buchst. a BSIG"),
                },
                {
                    "key": "bsig_2_11_b",
                    "kind": "criterion",
                    "label": "Considerable damage to others",
                    "detail": "The incident has affected or can affect other natural or legal persons by causing considerable "
                    "material or non-material damage.",
                    "ref": _lib("BSIG", "2.11.b", "§ 2 Nr. 11 Buchst. b BSIG"),
                },
            ],
        },
        {
            "key": "exclusions",
            "title": "Exclusion",
            "intro": None,
            "source": None,
            "profiles": ["default"],
            "criteria": [
                {
                    "key": "ir_3_2",
                    "kind": "exclusion",
                    "label": "Scheduled maintenance",
                    "detail": "The interruption is a scheduled interruption of service or a planned consequence of scheduled "
                    "maintenance carried out by or on behalf of the entity.",
                    "ref": _lib("IR2024/2690", "3.2", "IR 2024/2690 Art. 3(2)"),
                },
            ],
        },
    ],
    "NL": [
        {
            "key": "cbw",
            "title": "Definition in Cbw Art. 25(2)",
            "intro": "An incident is significant if it meets either limb of the statutory definition. This applies to all "
            "sectors.",
            "source": _lib("CBW", "25.2", "Cbw Art. 25 lid 2"),
            "profiles": ["ezk_manufacturing", "other"],
            "criteria": [
                {
                    "key": "cbw_25_2_a",
                    "kind": "criterion",
                    "label": "Severe operational disruption or financial loss",
                    "detail": "The incident causes or can cause severe operational disruption of the services or financial "
                    "losses for the entity.",
                    "ref": _lib("CBW", "25.2.a", "Cbw Art. 25 lid 2, onderdeel a"),
                },
                {
                    "key": "cbw_25_2_b",
                    "kind": "criterion",
                    "label": "Considerable damage to other entities",
                    "detail": "The incident has affected or can affect other entities by causing considerable material or "
                    "non-material damage.",
                    "ref": _lib("CBW", "25.2.b", "Cbw Art. 25 lid 2, onderdeel b"),
                },
            ],
        },
        {
            "key": "ezk_7",
            "title": "General criteria, Regeling cyberbeveiliging EZK Art. 7(1)",
            "intro": "For the sectors of the Ministry of Economic Affairs an incident is in any case significant if:",
            "source": _url(EZK_URL, "Regeling cyberbeveiliging EZK"),
            "profiles": ["ezk_manufacturing"],
            "criteria": [
                {
                    "key": "ezk_7_1_a",
                    "kind": "criterion",
                    "label": "Death of one or more persons",
                    "detail": "It has caused or can cause the death of one or more natural persons.",
                    "ref": _url(EZK_URL, "Regeling cyberbeveiliging EZK Art. 7(1)(a)"),
                },
                {
                    "key": "ezk_7_1_b",
                    "kind": "criterion",
                    "label": "Considerable damage to health",
                    "detail": "It has caused or can cause considerable damage to the health of one or more natural persons.",
                    "ref": _url(EZK_URL, "Regeling cyberbeveiliging EZK Art. 7(1)(b)"),
                },
            ],
        },
        {
            "key": "ezk_12",
            "title": "Manufacturing, Regeling cyberbeveiliging EZK Art. 12",
            "intro": "For essential and important entities in the manufacturing sector an incident is in any case "
            "significant if:",
            "source": _url(EZK_URL, "Regeling cyberbeveiliging EZK"),
            "profiles": ["ezk_manufacturing"],
            "criteria": [
                {
                    "key": "ezk_12_a",
                    "kind": "criterion",
                    "label": "Safety functions lost",
                    "detail": "Safety functions have been lost.",
                    "ref": _url(EZK_URL, "Regeling cyberbeveiliging EZK Art. 12(a)"),
                },
                {
                    "key": "ezk_12_b",
                    "kind": "criterion",
                    "label": "Control or monitoring functions lost",
                    "detail": "The availability or integrity of essential control or monitoring functions has been lost.",
                    "ref": _url(EZK_URL, "Regeling cyberbeveiliging EZK Art. 12(b)"),
                },
                {
                    "key": "ezk_12_c",
                    "kind": "criterion",
                    "label": "Production process endangered",
                    "detail": "The continuity of the production process has been or can be endangered.",
                    "ref": _url(EZK_URL, "Regeling cyberbeveiliging EZK Art. 12(c)"),
                },
                {
                    "key": "ezk_12_d",
                    "kind": "criterion",
                    "label": "Environmental damage",
                    "detail": "Environmental damage within the meaning of Art. 17.6(1) Wet milieubeheer has occurred.",
                    "ref": _url(EZK_URL, "Regeling cyberbeveiliging EZK Art. 12(d)"),
                },
                {
                    "key": "ezk_12_e",
                    "kind": "criterion",
                    "label": "Unauthorised access spread across zones",
                    "detail": "Unauthorised access to an industry-specific network and information system has occurred and has "
                    "spread to several zones or environments (a zone is a logical or physical group of systems, "
                    "devices or processes with similar security requirements, Art. 1).",
                    "ref": _url(EZK_URL, "Regeling cyberbeveiliging EZK Art. 12(e)"),
                },
            ],
        },
        {
            "key": "exclusions",
            "title": "Exclusion",
            "intro": None,
            "source": None,
            "profiles": ["ezk_manufacturing"],
            "criteria": [
                {
                    "key": "ezk_7_3",
                    "kind": "exclusion",
                    "label": "Planned maintenance",
                    "detail": "The interruption, suspension or termination of a service is a foreseen consequence of planned "
                    "maintenance carried out by or on behalf of the entity.",
                    "ref": _url(EZK_URL, "Regeling cyberbeveiliging EZK Art. 7(3)"),
                },
            ],
        },
    ],
}

PROFILE_NOTES = {
    (
        "NL",
        "other",
    ): "Sector-specific criteria are set by the regulation (Cyberbeveiligingsregeling) of the ministry "
    "responsible for the sector, for example the IenW regulation for chemicals. Check it in addition to "
    "the Cbw definition; it is not built into this wizard.",
}


def criteria_for(jurisdiction: str, profile: str) -> list[dict]:
    return [g for g in CRITERIA.get(jurisdiction, []) if profile in g["profiles"]]


def evaluate(jurisdiction: str, profile: str, answers: dict[str, str]) -> tuple[str, list[str]]:
    """Suggested result and the keys of the criteria answered 'yes'."""
    groups = criteria_for(jurisdiction, profile)
    crit = [c for g in groups for c in g["criteria"] if c["kind"] == "criterion"]
    excl = [c for g in groups for c in g["criteria"] if c["kind"] == "exclusion"]
    if any(answers.get(c["key"]) == "yes" for c in excl):
        return "not_significant", []
    met = [c["key"] for c in crit if answers.get(c["key"]) == "yes"]
    if met:
        return "significant", met
    if all(answers.get(c["key"]) == "no" for c in crit):
        return "not_significant", []
    return "undetermined", []


def criterion_label(key: str) -> str:
    for groups in CRITERIA.values():
        for g in groups:
            for c in g["criteria"]:
                if c["key"] == key:
                    return c["ref"]["label"]
    return key


# --- report stages -------------------------------------------------------------------------------------------

STAGE_LABELS = {
    "early_warning": "Early warning",
    "notification": "Incident notification",
    "intermediate": "Intermediate report",
    "progress": "Progress report",
    "final": "Final report",
}

_DE = {
    "early_warning": {
        "window": "24 h",
        "ref": _lib("BSIG", "32.1.1", "§ 32 Abs. 1 Nr. 1 BSIG"),
        "items": [
            ("malicious", "Whether unlawful or malicious acts are suspected"),
            ("cross_border", "Whether the incident could have a cross-border impact"),
        ],
    },
    "notification": {
        "window": "72 h",
        "ref": _lib("BSIG", "32.1.2", "§ 32 Abs. 1 Nr. 2 BSIG"),
        "items": [
            ("update", "Early-warning information confirmed or updated"),
            ("assessment", "Initial assessment incl. severity and impact"),
            ("ioc", "Indicators of compromise, where available"),
        ],
    },
    "intermediate": {
        "window": "on request",
        "ref": _lib("BSIG", "32.1.3", "§ 32 Abs. 1 Nr. 3 BSIG"),
        "items": [("status", "Relevant status updates")],
    },
    "progress": {
        "window": "instead of the final report while the incident is ongoing",
        "ref": _lib("BSIG", "32.2", "§ 32 Abs. 2 BSIG"),
        "items": [("status", "Current state of the aspects of the final report")],
    },
    "final": {
        "window": "1 month after the notification",
        "ref": _lib("BSIG", "32.1.4", "§ 32 Abs. 1 Nr. 4 BSIG"),
        "items": [
            ("description", "Detailed description incl. severity and impact"),
            ("root_cause", "Type of threat or underlying root cause"),
            ("mitigation", "Applied and ongoing mitigation measures"),
            ("cross_border", "Cross-border impact, where applicable"),
        ],
    },
}

_NL = {
    "early_warning": {
        "window": "24 h",
        "ref": _lib("CBW", "26", "Cbw Art. 26, Cbb Art. 24"),
        "items": [
            ("malicious", "Whether an unlawful or malicious act is suspected (Cbw 26(2)(a))"),
            ("cross_border", "Whether cross-border effects are possible (Cbw 26(2)(b))"),
            ("contact", "Contact details of the officer responsible for the report (Cbw 26(2)(c))"),
            ("start_time", "Suspected start time of the incident (Cbb 24(a))"),
            ("nature", "Nature and currently noticeable consequences, if possible (Cbb 24(b))"),
            ("recovery", "Forecast of the recovery time, if possible (Cbb 24(c))"),
            (
                "measures",
                "Measures planned or taken to limit consequences or prevent recurrence, if possible (Cbb 24(d))",
            ),
        ],
    },
    "notification": {
        "window": "72 h",
        "ref": _lib("CBW", "27.1", "Cbw Art. 27 lid 1"),
        "items": [
            ("update", "Update of the early-warning information (27(1)(a))"),
            ("assessment", "Initial assessment incl. severity and consequences (27(1)(b))"),
            ("ioc", "Indicators of compromise, if available (27(1)(c))"),
            ("cross_border", "Information to determine cross-border effects (27(1)(d))"),
        ],
    },
    "intermediate": {
        "window": "on request",
        "ref": _lib("CBW", "28", "Cbw Art. 28"),
        "items": [("status", "Relevant updates of the situation")],
    },
    "progress": {
        "window": "instead of the final report while the incident is ongoing",
        "ref": _lib("CBW", "29.2", "Cbw Art. 29 lid 2"),
        "items": [("status", "State of the aspects of the final report")],
    },
    "final": {
        "window": "1 month after the notification",
        "ref": _lib("CBW", "29.1", "Cbw Art. 29 lid 1"),
        "items": [
            ("description", "Detailed description, severity and consequences (29(1)(a))"),
            ("root_cause", "Type of threat or root cause (29(1)(b))"),
            ("mitigation", "Applied and ongoing mitigating measures (29(1)(c))"),
            ("cross_border", "Cross-border effects, where applicable (29(1)(d))"),
        ],
    },
}

_GDPR = {
    "notification": {
        "window": "72 h",
        "ref": _url(GDPR_URL, "GDPR Art. 33"),
        "items": [
            (
                "nature",
                "Nature of the breach incl. categories and approximate number of data subjects and records",
            ),
            ("dpo", "Name and contact details of the DPO or other contact point"),
            ("consequences", "Likely consequences of the breach"),
            ("measures", "Measures taken or proposed, incl. mitigation"),
            ("delay", "Reasons for any delay beyond 72 hours"),
        ],
    },
}

_CRA = {
    "early_warning": {
        "window": "24 h",
        "ref": _url(CRA_URL, "CRA Art. 14(4)(a)"),
        "items": [
            ("malicious", "Whether unlawful or malicious acts are suspected"),
            ("member_states", "Member States where the product is made available, where applicable"),
        ],
    },
    "notification": {
        "window": "72 h",
        "ref": _url(CRA_URL, "CRA Art. 14(4)(b)"),
        "items": [
            ("nature", "General information on the nature of the incident"),
            ("assessment", "Initial assessment of the incident"),
            ("measures", "Corrective or mitigating measures taken and recommended for users"),
            ("sensitivity", "How sensitive the notified information is"),
        ],
    },
    "final": {
        "window": "1 month after the notification",
        "ref": _url(CRA_URL, "CRA Art. 14(4)(c)"),
        "items": [
            ("description", "Detailed description incl. severity and impact"),
            ("root_cause", "Type of threat or root cause"),
            ("mitigation", "Applied and ongoing mitigation measures"),
        ],
    },
}


def stage_specs(regime: str, jurisdiction: str | None) -> dict:
    if regime == "gdpr":
        return _GDPR
    if regime == "cra":
        return _CRA
    return _NL if jurisdiction == "NL" else _DE


def default_authority(regime: str, entity) -> str:
    country = entity.country
    jur = get_jurisdiction(country)
    if regime == "gdpr":
        return "Autoriteit Persoonsgegevens" if country == "NL" else "Data protection supervisory authority"
    if regime == "cra":
        return "ENISA Single Reporting Platform (CSIRT coordinator)"
    if jur and jur.code == "NL":
        csirt = entity.csirt or "NCSC-NL"
        auth = entity.competent_authority or "competent authority"
        return f"{csirt} and {auth} via MijnNCSC"[:200]
    return "BSI (BSI-Portal, joint reporting office of BSI and BBK)"
