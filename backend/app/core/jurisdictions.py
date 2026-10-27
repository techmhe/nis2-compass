"""Jurisdiction registry: what differs per country in which an entity of the group operates.

Adding a country is one entry here. Values are moved over unchanged from the former per-module constants.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Jurisdiction:
    code: str
    name: str
    law_label: str
    competent_authority: str
    csirt: str
    portal: str
    legal_forms: tuple[str, ...]
    # registration copy sheet: (field, legal reference) in the order the portal asks for them
    sheet_order: tuple[tuple[str, str], ...]


_DE_SHEET = (
    ("legal_name", "§ 33(1) Nr. 1"),
    ("legal_form", "§ 33(1) Nr. 1"),
    ("register_number", "§ 33(1) Nr. 1"),
    ("address", "§ 33(1) Nr. 2"),
    ("contact_person", "§ 33(1) Nr. 2"),
    ("contact_person_email", "§ 33(1) Nr. 2"),
    ("contact_person_phone", "§ 33(1) Nr. 2"),
    ("contact_point", "§ 33(1) Nr. 2"),
    ("contact_point_email", "§ 33(1) Nr. 2"),
    ("contact_point_phone", "§ 33(1) Nr. 2"),
    ("public_ip_ranges", "§ 33(1) Nr. 2"),
    ("entity_type", "§ 33(1) Nr. 3"),
    ("sectors", "§ 33(1) Nr. 3"),
    ("member_states", "§ 33(1) Nr. 4"),
    ("authorities", "§ 33(1) Nr. 4"),
    ("domain_names", "optional"),
)

_NL_SHEET = (
    ("legal_name", "Cbw Art. 44(1)(a)"),
    ("register_number", "Cbb Art. 27 (KvK)"),
    ("legal_form", "Cbb Art. 27"),
    ("entity_type", "Cbw Art. 44(1)(b)"),
    ("sectors", "Cbw Art. 44(1)(b)"),
    ("address", "Cbw Art. 44(1)(c)"),
    ("contact_person", "Cbw Art. 44(1)(c)"),
    ("contact_person_email", "Cbw Art. 44(1)(c)"),
    ("contact_person_phone", "Cbw Art. 44(1)(c)"),
    ("contact_point", "Cbw Art. 44(1)(c)"),
    ("contact_point_email", "Cbw Art. 44(1)(c)"),
    ("contact_point_phone", "Cbw Art. 44(1)(c)"),
    ("member_states", "Cbw Art. 44(1)(d)"),
    ("public_ip_ranges", "Cbw Art. 44(1)(e)"),
    ("domain_names", "Cbb Art. 27"),
    ("authorities", "Cbw Art. 44"),
)

JURISDICTIONS: dict[str, Jurisdiction] = {
    "DE": Jurisdiction(
        code="DE",
        name="Germany",
        law_label="BSIG",
        competent_authority="BSI",
        csirt="BSI",
        portal="BSI portal (MUK / ELSTER)",
        legal_forms=(
            "GmbH",
            "AG",
            "SE",
            "KG",
            "GmbH & Co. KG",
            "OHG",
            "UG (haftungsbeschränkt)",
            "e.K.",
            "eG",
        ),
        sheet_order=_DE_SHEET,
    ),
    "NL": Jurisdiction(
        code="NL",
        name="Netherlands",
        law_label="Cbw / Cbb",
        competent_authority="RDI / sector authority",
        csirt="CSIRT-DSP / NCSC-NL",
        portal="MijnNCSC (eHerkenning)",
        legal_forms=(
            "B.V.",
            "N.V.",
            "C.V.",
            "Coöperatie",
            "Stichting",
            "Vennootschap onder firma",
            "Eenmanszaak",
        ),
        sheet_order=_NL_SHEET,
    ),
}

SIZE_CLASSES: tuple[str, ...] = ("micro", "small", "medium", "large")

# NIS2 Annex I (sectors of high criticality) and Annex II (other critical sectors), plus a catch-all.
SECTORS: dict[str, str] = {
    # Annex I
    "energy_electricity": "Energy: electricity",
    "energy_district_heating": "Energy: district heating and cooling",
    "energy_oil": "Energy: oil",
    "energy_gas": "Energy: gas",
    "energy_hydrogen": "Energy: hydrogen",
    "transport_air": "Transport: air",
    "transport_rail": "Transport: rail",
    "transport_water": "Transport: water",
    "transport_road": "Transport: road",
    "banking": "Banking",
    "financial_market_infrastructure": "Financial market infrastructures",
    "health": "Health",
    "drinking_water": "Drinking water",
    "waste_water": "Waste water",
    "digital_infrastructure": "Digital infrastructure",
    "ict_service_management": "ICT service management (business-to-business)",
    "public_administration": "Public administration",
    "space": "Space",
    # Annex II
    "postal_courier": "Postal and courier services",
    "waste_management": "Waste management",
    "chemicals": "Manufacture, production and distribution of chemicals",
    "food": "Production, processing and distribution of food",
    "manufacturing_medical_devices": "Manufacturing: medical devices and in vitro diagnostic devices",
    "manufacturing_electronics": "Manufacturing: computer, electronic and optical products",
    "manufacturing_electrical_equipment": "Manufacturing: electrical equipment",
    "manufacturing_machinery": "Manufacturing: machinery and equipment n.e.c.",
    "manufacturing_motor_vehicles": "Manufacturing: motor vehicles, trailers and semi-trailers",
    "manufacturing_other_transport": "Manufacturing: other transport equipment",
    "digital_providers": "Digital providers (marketplaces, search engines, social networks)",
    "research": "Research",
    "other": "Other (outside NIS2 Annex I and II)",
}


def get_jurisdiction(code: str | None) -> Jurisdiction | None:
    return JURISDICTIONS.get(code) if code else None


def sector_label(key: str | None) -> str | None:
    """The label of a sector key; a value that is not a key (data from before sector keys) is returned as is."""
    return SECTORS.get(key, key) if key else None


def entity_options() -> dict:
    """The choices behind the entity fields country, legal form, sector and size class."""
    return {
        "jurisdictions": [
            {
                "code": j.code,
                "name": j.name,
                "legal_forms": list(j.legal_forms),
                "competent_authority": j.competent_authority,
                "csirt": j.csirt,
            }
            for j in JURISDICTIONS.values()
        ],
        "sectors": [{"key": k, "label": v} for k, v in SECTORS.items()],
        "size_classes": list(SIZE_CLASSES),
    }
