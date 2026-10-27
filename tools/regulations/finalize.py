import json, subprocess, os

import os as _os
REG = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "backend", "app", "seed", "regulations")
D = REG + "/"
os.environ["PYTHONPATH"] = "site"

NOTES = {
    "nis2_directive.json": (None,
        "In force since 16 January 2023 (Art. 45); Member States had to transpose by 17 October 2024 and apply national measures from 18 October 2024 (Art. 41). Transposed in Germany by the BSIG 2025 (in force 6 December 2025) and in the Netherlands by the Cyberbeveiligingswet (in force 15 August 2026). The Commission's Digital Omnibus (19 November 2025) and targeted NIS2 amendment proposal (20 January 2026) were still pending in the legislative procedure as of September 2026; this is the unamended OJ text."),
    "ir_2024_2690.json": (None,
        "Adopted 17 October 2024, published OJ 18 October 2024, in force 7 November 2024 (Art. 16); directly binding only for the entity types listed in Art. 1 (DNS, TLD, cloud, data centre, CDN, MSP/MSSP, online marketplaces, search engines, social networks, trust service providers). For all other entities the Annex is the de facto reference: § 30(3) BSIG gives it precedence for the listed types, and the Dutch Cyberbeveiligingsbesluit (Art. 4–18) mirrors its structure. ENISA published non-binding Technical Implementation Guidance (v1.0, 26 June 2025)."),
    "bsig.json": ("2026-07-28",
        "Enacted as Article 1 of the Gesetz zur Umsetzung der NIS-2-Richtlinie und zur Regelung wesentlicher Grundzüge des Informationssicherheitsmanagements in der Bundesverwaltung (NIS2UmsuCG) of 2 December 2025 (BGBl. 2025 I Nr. 301, promulgated 5 December 2025), in force 6 December 2025, replacing the BSIG 2009. Amended by Art. 4 of the KRITIS-Dachgesetz umbrella act of 11 March 2026 (BGBl. 2026 I Nr. 66, in force 17 March 2026) and by acts of 21 and 23 July 2026 (BGBl. 2026 I Nr. 221, Nr. 226), included per the source (consolidated XML built 28 July 2026). Registration under § 33 was due by 6 March 2026 for entities in scope on 6 December 2025."),
    "stoerfallv.json": ("2026-05-06",
        "In force; original of 26 April 2000 (BGBl. I S. 603), re-promulgated 15 March 2017 (BGBl. I S. 483), last amended by Art. 7 of the act of 3 July 2024 (BGBl. 2024 I Nr. 225); implements the Seveso-III Directive 2012/18/EU. Included: §§ 1–21 and Anhang II (Sicherheitsbericht) and Anhang III (Sicherheitsmanagementsystem); Anhänge I and IV–VII (substance lists, forms) are omitted. Relevant to OT security via § 3(2) Nr. 3 (Eingriffe Unbefugter), § 8/Anhang III and § 9/Anhang II."),
}
NL = {
    "cbw": "Wet van 8 juli 2026 (Stb. 2026, 187), dossier 36 764: adopted by the Tweede Kamer on 15 April 2026 and by the Eerste Kamer on 7 July 2026, in force 15 August 2026 (Art. 35 Cyberbeveiligingsbesluit, Stb. 2026, 189), replacing the Wbni. Official consolidated text from wetten.overheid.nl (BWBR0052872), version valid from 15 August 2026. Board members must meet the training/certificate requirement of Art. 24 by 15 August 2028 (new board members: within two years of appointment).",
    "cbb": "Besluit van 8 juli 2026 (Stb. 2026, 189), in force 15 August 2026 together with the Cbw. It elaborates the zorgplicht (Art. 5–19, following the structure of the IR 2024/2690 Annex), board training and certificate (Art. 20–22), reporting (Art. 23–26) and registration data (Art. 27). Sector-specific ministerial Cyberbeveiligingsregelingen (Stcrt. 2026) set significant-incident thresholds and designate sector CSIRTs. Consolidated text from wetten.overheid.nl (BWBR0052875), version valid from 15 August 2026.",
}
json.dump(NL, open("nl_status.json", "w", encoding="utf-8"), ensure_ascii=False)

subprocess.run(["python3", "build_nis2.py", NOTES["nis2_directive.json"][1]], check=True)
subprocess.run(["python3", "build_ir.py", NOTES["ir_2024_2690.json"][1]], check=True)
subprocess.run(["python3", "build_bsig.py", NOTES["bsig.json"][1], NOTES["bsig.json"][0]], check=True)
subprocess.run(["python3", "build_stoerfall.py", NOTES["stoerfallv.json"][1], NOTES["stoerfallv.json"][0]], check=True)
subprocess.run(["python3", "build_nl.py", "status"], check=True)
subprocess.run(["python3", "build_iso.py"], check=True)
