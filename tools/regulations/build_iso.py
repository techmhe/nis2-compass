import json

import os as _os
REG = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "backend", "app", "seed", "regulations")
OUT = REG + "/iso27001_2022.json"

CLAUSES = [
    ("4", "Context of the organization", [
        ("4.1", "Understanding the organization and its context", []),
        ("4.2", "Understanding the needs and expectations of interested parties", []),
        ("4.3", "Determining the scope of the information security management system", []),
        ("4.4", "Information security management system", []),
    ]),
    ("5", "Leadership", [
        ("5.1", "Leadership and commitment", []),
        ("5.2", "Policy", []),
        ("5.3", "Organizational roles, responsibilities and authorities", []),
    ]),
    ("6", "Planning", [
        ("6.1", "Actions to address risks and opportunities", [
            ("6.1.1", "General", []),
            ("6.1.2", "Information security risk assessment", []),
            ("6.1.3", "Information security risk treatment", []),
        ]),
        ("6.2", "Information security objectives and planning to achieve them", []),
        ("6.3", "Planning of changes", []),
    ]),
    ("7", "Support", [
        ("7.1", "Resources", []),
        ("7.2", "Competence", []),
        ("7.3", "Awareness", []),
        ("7.4", "Communication", []),
        ("7.5", "Documented information", [
            ("7.5.1", "General", []),
            ("7.5.2", "Creating and updating", []),
            ("7.5.3", "Control of documented information", []),
        ]),
    ]),
    ("8", "Operation", [
        ("8.1", "Operational planning and control", []),
        ("8.2", "Information security risk assessment", []),
        ("8.3", "Information security risk treatment", []),
    ]),
    ("9", "Performance evaluation", [
        ("9.1", "Monitoring, measurement, analysis and evaluation", []),
        ("9.2", "Internal audit", [
            ("9.2.1", "General", []),
            ("9.2.2", "Internal audit programme", []),
        ]),
        ("9.3", "Management review", [
            ("9.3.1", "General", []),
            ("9.3.2", "Management review inputs", []),
            ("9.3.3", "Management review results", []),
        ]),
    ]),
    ("10", "Improvement", [
        ("10.1", "Continual improvement", []),
        ("10.2", "Nonconformity and corrective action", []),
    ]),
]

A5 = """Policies for information security
Information security roles and responsibilities
Segregation of duties
Management responsibilities
Contact with authorities
Contact with special interest groups
Threat intelligence
Information security in project management
Inventory of information and other associated assets
Acceptable use of information and other associated assets
Return of assets
Classification of information
Labelling of information
Information transfer
Access control
Identity management
Authentication information
Access rights
Information security in supplier relationships
Addressing information security within supplier agreements
Managing information security in the information and communication technology (ICT) supply chain
Monitoring, review and change management of supplier services
Information security for use of cloud services
Information security incident management planning and preparation
Assessment and decision on information security events
Response to information security incidents
Learning from information security incidents
Collection of evidence
Information security during disruption
ICT readiness for business continuity
Legal, statutory, regulatory and contractual requirements
Intellectual property rights
Protection of records
Privacy and protection of personal identifiable information (PII)
Independent review of information security
Compliance with policies, rules and standards for information security
Documented operating procedures"""
A6 = """Screening
Terms and conditions of employment
Information security awareness, education and training
Disciplinary process
Responsibilities after termination or change of employment
Confidentiality or non-disclosure agreements
Remote working
Information security event reporting"""
A7 = """Physical security perimeters
Physical entry
Securing offices, rooms and facilities
Physical security monitoring
Protecting against physical and environmental threats
Working in secure areas
Clear desk and clear screen
Equipment siting and protection
Security of assets off-premises
Storage media
Supporting utilities
Cabling security
Equipment maintenance
Secure disposal or re-use of equipment"""
A8 = """User endpoint devices
Privileged access rights
Information access restriction
Access to source code
Secure authentication
Capacity management
Protection against malware
Management of technical vulnerabilities
Configuration management
Information deletion
Data masking
Data leakage prevention
Information backup
Redundancy of information processing facilities
Logging
Monitoring activities
Clock synchronization
Use of privileged utility programs
Installation of software on operational systems
Networks security
Security of network services
Segregation of networks
Web filtering
Use of cryptography
Secure development life cycle
Application security requirements
Secure system architecture and engineering principles
Secure coding
Security testing in development and acceptance
Outsourced development
Separation of development, test and production environments
Change management
Test information
Protection of information systems during audit testing"""

GROUPS = [("5", "Organizational controls", A5), ("6", "People controls", A6), ("7", "Physical controls", A7),
          ("8", "Technological controls", A8)]


def clause(k, h, ch):
    return {"key": k, "ref": f"ISO/IEC 27001:2022, {k}", "heading": h, "text": "", "children": [clause(*c) for c in ch]}


provisions = [clause(*c) for c in CLAUSES]
annex = {"key": "annexA", "ref": "ISO/IEC 27001:2022, Annex A", "heading": "Information security controls reference", "text": "",
         "children": []}
total = 0
for g, h, lst in GROUPS:
    titles = [t.strip() for t in lst.strip().split("\n")]
    grp = {"key": f"A.{g}", "ref": f"Annex A {g}", "heading": h, "text": "", "children": []}
    for i, t in enumerate(titles, 1):
        grp["children"].append({"key": f"A.{g}.{i}", "ref": f"Annex A {g}.{i}", "heading": t, "text": "", "children": []})
        total += 1
    annex["children"].append(grp)
provisions.append(annex)
assert total == 93, total

doc = {
    "code": "ISO27001",
    "title": "ISO/IEC 27001:2022 Information security, cybersecurity and privacy protection — Information security management systems — Requirements",
    "short_title": "ISO/IEC 27001:2022",
    "kind": "standard",
    "jurisdiction": "INT",
    "language": "en",
    "version_date": "2022-10-25",
    "source_url": "https://www.iso.org/standard/27001",
    "status_note": "Current edition (3rd edition, published 25 October 2022), amended by ISO/IEC 27001:2022/Amd 1:2024 (climate action changes to clauses 4.1 and 4.2; no change to clause or control titles). The transition period for certifications to the 2013 edition ended on 31 October 2025. Voluntary standard; referenced as 'relevant European and international standards' under NIS2 Art. 21(1) and § 30(2) BSIG.",
    "license_note": "Copyrighted by ISO/IEC. Only clause/control numbers and titles are included (text intentionally empty); the full text must be purchased from ISO (iso.org) or national standards bodies (e.g. DIN/Beuth as DIN EN ISO/IEC 27001:2024, NEN as NEN-EN-ISO/IEC 27001).",
    "provisions": provisions,
}
json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("written", OUT, total, "controls")
