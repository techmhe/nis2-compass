# Regulations Library: research notes (as of 28 Sep 2026)

Seed files in this directory, with their sources:

| File | Code | Source | Text version |
|---|---|---|---|
| nis2_directive.json | NIS2 | Publications Office cellar (CELEX 32022L2555, OJ L 333, 27.12.2022) | OJ original, unamended |
| ir_2024_2690.json | IR2024/2690 | Publications Office cellar (CELEX 32024R2690, OJ L 18.10.2024) | Articles 1–16 in full, Annex as headings only |
| bsig.json | BSIG | gesetze-im-internet.de/bsig_2025/xml.zip | Consolidated XML built 28.07.2026 |
| cbw_nl.json | CBW | wetten.overheid.nl BWBR0052872 (BWB XML) | Valid from 15.08.2026 |
| cbb_nl.json | CBB | wetten.overheid.nl BWBR0052875 (BWB XML) | Valid from 15.08.2026 |
| stoerfallv.json | STOERFALLV | gesetze-im-internet.de/bimschv_12_2000/xml.zip | Built 06.05.2026, last amended by Art. 7 of the act of 3.7.2024 |
| iso27001_2022.json | ISO27001 | Clause and control titles only (copyright ISO) | ISO/IEC 27001:2022 + Amd 1:2024 |

EUR-Lex (`eur-lex.europa.eu/legal-content/...`) returned HTTP 202 (a bot challenge) to curl. The texts came instead from the Publications Office by content negotiation: `curl -H "Accept: application/xhtml+xml" -H "Accept-Language: eng" http://publications.europa.eu/resource/celex/<CELEX>`. Build scripts are in the session scratchpad and are not part of the repo.

## (a) Germany: NIS2UmsuCG and BSIG

- **Official title and dates.** The act is the *Gesetz zur Umsetzung der NIS-2-Richtlinie und zur Regelung wesentlicher Grundzüge des Informationssicherheitsmanagements in der Bundesverwaltung* (NIS2UmsuCG), dated 2 Dec 2025.
  - Parliament: the Bundestag passed it on 13 Nov 2025 and the Bundesrat approved it on 21 Nov 2025.
  - Publication: BGBl. 2025 I Nr. 301, promulgated 5 Dec 2025.
  - In force: **6 Dec 2025** (Art. 30).
  - Article 1 is the new BSIG, which replaces the BSIG 2009.
  - Sources: https://www.recht.bund.de/bgbl/1/2025/301/VO.html and the XML footnote "Es tritt gem. Art. 30 dieses G am 6.12.2025 in Kraft".
- **Later amendments.**
  - Art. 4 of the act of 11 Mar 2026 (BGBl. 2026 I Nr. 66). This act contains the KRITIS-Dachgesetz and implements the CER Directive. It was promulgated 16 Mar 2026 and has been in force since 17 Mar 2026. For example, § 33(2) now says that critical facilities (kritische Anlagen) register under § 8 KRITISDachG.
  - Art. 9 of the act of 21 Jul 2026 (BGBl. 2026 I Nr. 221) and Art. 8(1) of the act of 23 Jul 2026 (BGBl. 2026 I Nr. 226). The source lists both as incorporated.
- **Official source.** https://www.gesetze-im-internet.de/bsig_2025/ (the XML download is `xml.zip`, doknr BJNR12D0B0025). All 66 §§ and Anlagen 1 and 2 are included.
- **Mapping to NIS2** (checked against both texts):
  - **§ 30(2) Nr. 1–10 = NIS2 Art. 21(2)(a)–(j)**, one to one. Nr. 9 bundles personnel security, access control and ICT asset management, as point (i) does. Nr. 10 = (j), MFA and secured communications.
  - § 30(1) = Art. 21(1). It adds a duty to document compliance (§ 30(1) Satz 3), which Art. 21 does not contain.
  - § 30(3) gives precedence to IR 2024/2690 for the digital entity types. § 30(4) does the same for any future sectoral implementing act.
  - § 31 sets additional requirements for operators of critical facilities (attack detection systems). This goes beyond NIS2.
  - **§ 32 = Art. 23(4)**:
    - Abs. 1 Nr. 1: early warning within 24 h, = (a).
    - Abs. 1 Nr. 2: incident notification within 72 h, = (b).
    - Abs. 1 Nr. 3: intermediate report on request, = (c).
    - Abs. 1 Nr. 4: final report within 1 month, = (d).
    - Abs. 2: progress report, = (e).
  - § 35 (informing service recipients) = Art. 23(1) sentence 2 and Art. 23(2). § 36 (BSI feedback) = Art. 23(5).
  - **§ 33 = Art. 3(3)–(4)** (register and entity data). **§ 34 = Art. 27** (special registration for DNS, TLD, cloud, data centre, CDN, MSP/MSSP, marketplaces, search engines and social networks, with forwarding to ENISA).
  - **§ 38 = Art. 20.**
    - § 38(1): management must implement and monitor the § 30 measures. NIS2 says "approve and oversee".
    - § 38(2): management liability to the entity under corporate law.
    - § 38(3): training.
  - §§ 61–62 (supervision of important and essential entities) = Art. 32–33. § 65 (fines) = Art. 34.
  - § 28 and Anlagen 1–2 (scope, sectors) = Art. 2–3 and Annexes I–II.

## (b) Netherlands: Cbw and Cbb

- **Cbw.** Wet van 8 juli 2026 (Stb. 2026, 187). The **Kamerstuk dossier is 36 764**; 36 765 is the Wet weerbaarheid kritieke entiteiten (Wwke).
  - The Tweede Kamer adopted it on 15 Apr 2026 and the Eerste Kamer on 7 Jul 2026.
  - **In force 15 Aug 2026** (Art. 35 Cbb). It replaces the Wbni.
  - Consolidated text: https://wetten.overheid.nl/BWBR0052872/2026-08-15/0. It has 113 articles, including 21a, 103a and 103b, plus Bijlagen 1 and 2.
  - Sources: https://www.rijksoverheid.nl/actueel/nieuws/2026/07/07/cyberbeveiligingswet-en-wet-weerbaarheid-kritieke-entiteiten-vanaf-15-augustus-2026-van-kracht and https://www.eerstekamer.nl/wetsvoorstel/36764_cyberbeveiligingswet
- **Cbb.** Besluit van 8 juli 2026 (Stb. 2026, 189), in force 15 Aug 2026. Text: https://wetten.overheid.nl/BWBR0052875/2026-08-15/0 (36 articles).
  - Art. 6–18 follow the 13 themes of the IR 2024/2690 Annex. Art. 4 excludes the IR entity types, which are covered by the IR directly.
  - Sector-specific ministerial *Cyberbeveiligingsregelingen* were published in the Staatscourant in July/Aug 2026, for example Stcrt. 2026, 24093 (IenW) and 28763 (VWS). They set thresholds for significant incidents and designate sector CSIRTs.
- **Article mapping:**

  | NIS2 | Cbw | Cbb |
  |---|---|---|
  | Art. 20 | Art. 24 (governance, board knowledge and certificate) | Art. 20–22 (training) |
  | Art. 21 | Art. 21, with **21(3)(a)–(j) = 21(2)(a)–(j)** one to one; 21(4) supply-chain factors = 21(3) | Art. 5–19 |
  | Art. 23 | Art. 25 (duty), 26 (24 h early warning), 27 (72 h notification), 28 (intermediate report), 29 (final report within 1 month, or progress report), 30 (informing recipients) | Art. 23–26 |
  | Art. 3(3)–(4) and 27 | Art. 43 (national register), 44 (information to submit, changes within 2 weeks), 47 (ENISA register) | Art. 27 (additional registration data, e.g. KvK number) |

## (c) Incident reporting deadlines

- **Germany (§ 32 BSIG).**
  - Deadlines: an early warning within **24 h** of becoming aware, a notification within **72 h**, an intermediate report on request, and a final report **1 month** after the notification (or a progress report if the incident is ongoing).
  - Channel: the joint reporting office of BSI and BBK. The obligation applies "frühestens ab Einrichtung des Meldewegs". The **BSI-Portal** went live on **6 Jan 2026** for registration and reporting.
  - Entities not yet registered report through the BSI online form in the MIP. Operators of critical facilities and federal bodies temporarily use their existing channels.
  - Operators of critical facilities must also give facility and critical-service data (§ 32(3)).
  - Source: https://www.bsi.bund.de/DE/Themen/Regulierte-Wirtschaft/NIS-2-regulierte-Unternehmen/NIS-2-Infopakete/NIS-2-Meldepflicht/NIS-2-Meldepflicht_node.html
- **Netherlands (Cbw Art. 25–29).** The deadlines are the same: 24 h, 72 h, on request, and 1 month.
  - The report goes to both the **CSIRT** and the **bevoegde autoriteit**, through the single central reporting portal **MijnNCSC** (Cbb Art. 25), which forwards it to both.
  - The CSIRT is NCSC-NL for most sectors (Z-CERT for health care).
  - The supervisor depends on the sector:
    - RDI for manufacturing (vervaardiging), digital infrastructure and digital providers (Ministry of Economic Affairs).
    - ILT for chemicals (Ministry of Infrastructure and Water Management).
    - IGJ for health care.
  - Sources: https://www.nctv.nl/onderwerpen/c/cyberbeveiligingswet/meldplicht and https://www.ncsc.nl/cyberbeveiligingswet-nis2/toezicht-op-de-cyberbeveiligingswet-nis2-hoe-zit-dat

## (d) Registration

- **Germany (§ 33 BSIG).** Entities must register within **3 months** of first qualifying, through the joint BSI/BBK registration facility in the BSI-Portal. Login is via "Mein Unternehmenskonto" (MUK) with an ELSTER organisation certificate.
  - Data to submit: name, legal form and commercial register number; address and contacts, including public IP ranges; sector; EU Member States served; and the competent supervisory authorities.
  - Changes must be reported within 2 weeks (§ 33(5)).
  - For entities in scope on 6 Dec 2025, the **deadline was 6 Mar 2026**. Missing it is an administrative offence under § 65(2) Nr. 6.
  - Digital entity types register under § 34 as well.
  - Sources: https://www.bsi.bund.de/DE/Themen/Regulierte-Wirtschaft/NIS-2-regulierte-Unternehmen/Registrierungspflicht/registrierungspflicht.html and https://www.dhpg.de/de/newsroom/blog/registrierungspflicht-nach-nis-2-bsi-portal-freigeschaltet-frist-maerz-2026
- **Netherlands (Cbw Art. 43–44, Cbb Art. 27).** Registration has been **mandatory since 15 Aug 2026** in the entity register via **MijnNCSC** (mijn.ncsc.nl), using eHerkenning or SSO-Rijk.
  - Data: Art. 44(1)(a)–(f) plus Cbb Art. 27 (type of entity, KvK number).
  - Changes must be reported within 2 weeks (Art. 44(2)). The Minister had to set up the register within one month of entry into force (Art. 98).
  - Sources: https://www.nctv.nl/onderwerpen/c/cyberbeveiligingswet/vragen-en-antwoorden and https://www.ncsc.nl/nieuws/cbw-en-wwke-vanaf-15-augustus-2026-van-kracht
- **Group note (DE headquarters with DE and NL subsidiaries).** Registration and reporting attach to each legal entity in the jurisdiction where it is established (NIS2 Art. 26(1)). The German companies therefore register with the BSI, and the Dutch subsidiaries register via MijnNCSC.

## (e) ENISA and other guidance

- **ENISA Technical Implementation Guidance** on IR 2024/2690, v1.0, 26 June 2025 (170 pages). It is non-binding, mirrors the 13 Annex sections, and gives examples of evidence and mappings to standards (ISO 27001/27002 and national frameworks).
  - https://www.enisa.europa.eu/publications/nis2-technical-implementation-guidance
  - PDF: https://www.enisa.europa.eu/sites/default/files/2025-06/ENISA_Technical_implementation_guidance_on_cybersecurity_risk_management_measures_version_1.0.pdf
- **ENISA "Mapping NIS2 obligations with ECSF role profiles"**, June 2025. Useful for chapter 8 (training) and chapter 16 (management).
- **Pending EU changes, not in force as of Sept 2026:**
  - Digital Omnibus (19 Nov 2025): a single reporting entry point and NIS2 alignment.
  - Targeted NIS2 amendment proposal (20 Jan 2026): a small mid-cap category, jurisdiction rules and ransomware data; Member States would transpose within one year of adoption.
  - https://digital-strategy.ec.europa.eu/en/library/proposal-directive-regards-simplification-measures-and-alignment-cybersecurity-act
- **ISO/IEC 27001.** There is no new edition. The 2022 edition with Amd 1:2024 is current, and the transition from the 2013 edition ended 31 Oct 2025.
- **Chapter 17 (OT).** The StörfallV addresses cyber attacks through "Eingriffe Unbefugter" (§ 3(2) Nr. 3). The Kommission für Anlagensicherheit (KAS) guidance on protection against unauthorised interventions (KAS-51) is the usual practical reference. I did not verify its current version.

## (f) Management training

- **Germany, § 38(3) BSIG.** The management of essential and important entities "müssen regelmäßig an Schulungen teilnehmen" so that they can recognise and assess IT-security risks and risk-management practices and their impact on the entity's services.
  - The law sets no certificate requirement, no fixed deadline and no minimum duration. Treat the duty as applying since 6 Dec 2025.
  - § 38(1) requires management to implement and monitor the measures, and § 38(2) sets their liability.
  - NIS2 Art. 20(2) also encourages training for employees. § 30(2) Nr. 7 covers basic training for staff.
- **Netherlands, Cbw Art. 24(2)–(5) with Cbb Art. 20–22.** This is stricter than the German rule.
  - Each board member must have the relevant knowledge and skills, keep them demonstrably up to date, and **hold a certificate** from a training covering the topics set in Cbb Art. 21.
  - The certificate must be in Dutch or English and show the name, date(s), topics covered and training provider (Cbb Art. 22).
  - Deadline: **within 2 years of entry into force, i.e. by 15 Aug 2028**, or within 2 years of appointment for new board members.
  - In a one-tier board, the duty applies only to executive directors (Art. 24(8)).
  - Art. 24(1) requires the board to approve the Art. 21 measures.

## Gaps and representation choices

- **IR 2024/2690 Annex:** only the section and subsection headings (annex.1 to annex.13.3) are included, as requested; the requirement texts are omitted.
- **NIS2:** Annex III (correlation table), recitals and footnotes are omitted. The Annex I and II tables are flattened into one child per sector (`annex1.1` and so on).
- **StörfallV:** Anhänge I and IV–VII (substance lists, forms and similar) are omitted. § 14 is "(weggefallen)" and has empty text.
- **BSIG § 8(4)** contains two numbered lists in one Absatz. The second list is under the key `8.4.l2` (children `8.4.l2.1` to `8.4.l2.3`).
- **Text that follows a list** (for example "Davon ausgenommen sind…") is appended to the parent paragraph's text after a newline.
- **Roman-numbered items in the StörfallV Anhänge** use lowercase roman keys (for example `anhang2.iii.3.a`).
- **Cbw Bijlagen** have no official title (heading = null). The rows are grouped per sector (`bijlage1.1` to `bijlage1.11`, `bijlage2.1` to `bijlage2.7`).
- **ISO/IEC 27001:2022:** titles only. They are reproduced from the standard's clause and control structure and cross-checked against several secondary lists; the only differences were comma and abbreviation style (5.21 and 5.34 use the spelled-out forms). Verify them against a purchased copy.
