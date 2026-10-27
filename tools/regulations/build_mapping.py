import json

import os as _os
REG = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "backend", "app", "seed", "regulations")
OUT = REG + "/mapping.json"


def L(reg, *keys):
    return [{"reg": reg, "key": k} for k in keys]


letters = "abcdefghij"
bsig_nr_to_nis2 = {str(i + 1): f"21.2.{letters[i]}" for i in range(10)}
cbw_onderdeel_to_nis2 = {l: f"21.2.{l}" for l in letters}

# chapter -> (NIS2 point(s), IR annex section, BSIG Nr(s), CBW onderdeel(en), CBB article(s), ISO keys)
M = {
    "1": (["21.2.a"], ["annex.1"], ["30.2.1"], ["21.3.a"], ["6"], ["5.2", "A.5.1", "A.5.2"]),
    "2": (["21.2.a"], ["annex.2"], ["30.2.1"], ["21.3.a"], ["7"], ["6.1.2", "6.1.3", "8.2", "8.3", "A.5.35", "A.5.36"]),
    "3": (["21.2.b"], ["annex.3"], ["30.2.2"], ["21.3.b"], ["8"], ["A.5.24", "A.5.25", "A.5.26", "A.5.27", "A.5.28", "A.6.8", "A.8.15", "A.8.16"]),
    "4": (["21.2.c"], ["annex.4"], ["30.2.3"], ["21.3.c"], ["9"], ["A.5.29", "A.5.30", "A.8.13", "A.8.14"]),
    "5": (["21.2.d", "21.3"], ["annex.5"], ["30.2.4"], ["21.3.d", "21.4"], ["10"], ["A.5.19", "A.5.20", "A.5.21", "A.5.22", "A.5.23"]),
    "6": (["21.2.e"], ["annex.6"], ["30.2.5"], ["21.3.e"], ["11", "17"], ["A.8.8", "A.8.9", "A.8.20", "A.8.22", "A.8.25", "A.8.29", "A.8.32"]),
    "7": (["21.2.f"], ["annex.7"], ["30.2.6"], ["21.3.f"], ["18"], ["9.1", "9.2", "9.3", "A.5.35"]),
    "8": (["21.2.g", "20.2"], ["annex.8"], ["30.2.7"], ["21.3.g"], ["12"], ["7.2", "7.3", "A.6.3"]),
    "9": (["21.2.h"], ["annex.9"], ["30.2.8"], ["21.3.h"], ["13"], ["A.8.24"]),
    "10": (["21.2.i"], ["annex.10"], ["30.2.9"], ["21.3.i"], ["14"], ["A.6.1", "A.6.2", "A.6.4", "A.6.5", "A.6.6"]),
    "11": (["21.2.i", "21.2.j"], ["annex.11"], ["30.2.9", "30.2.10"], ["21.3.i", "21.3.j"], ["15"], ["A.5.15", "A.5.16", "A.5.17", "A.5.18", "A.8.2", "A.8.5"]),
    "12": (["21.2.i"], ["annex.12"], ["30.2.9"], ["21.3.i"], ["16"], ["A.5.9", "A.5.10", "A.5.11", "A.5.12", "A.5.13", "A.7.10"]),
    "13": (["21.2", "21.2.c", "21.2.e", "21.2.i"], ["annex.13"], ["30.2"], ["21.3"], ["15"], ["A.7"]),
}

chapter_links = {}
for ch, (nis2, ir, bsig, cbw, cbb, iso) in M.items():
    chapter_links[ch] = L("NIS2", *nis2) + L("IR2024/2690", *ir) + L("BSIG", *bsig) + L("CBW", *cbw) + L("CBB", *cbb) + L("ISO27001", *iso)

chapter_links["14"] = (L("NIS2", "23", "23.1", "23.3", "23.4") + L("IR2024/2690", "3", "4") + L("BSIG", "32", "32.1", "32.2", "35", "36", "40")
                       + L("CBW", "25", "26", "27", "28", "29", "30") + L("CBB", "23", "24", "25"))
chapter_links["15"] = (L("NIS2", "3.3", "3.4", "27") + L("BSIG", "33", "34", "28")
                       + L("CBW", "43", "44", "47") + L("CBB", "27"))
chapter_links["16"] = (L("NIS2", "20", "20.1", "20.2") + L("BSIG", "38", "38.1", "38.2", "38.3")
                       + L("CBW", "24") + L("CBB", "20", "21", "22") + L("ISO27001", "5.1", "5.3", "9.3"))
chapter_links["17"] = (L("STOERFALLV", "3", "3.2.3", "4", "6", "8", "9", "anhang2", "anhang3") + L("BSIG", "30.1", "30.2", "31")
                       + L("NIS2", "21.1", "21.2") + L("CBW", "21.1", "21.3") + L("IR2024/2690", "annex.6.7", "annex.6.8", "annex.13"))

doc = {
    "bsig_nr_to_nis2": bsig_nr_to_nis2,
    "cbw_onderdeel_to_nis2": cbw_onderdeel_to_nis2,
    "cbb_article_to_ir_annex": {"6": "annex.1", "7": "annex.2", "8": "annex.3", "9": "annex.4", "10": "annex.5", "11": "annex.6",
                                 "12": "annex.8", "13": "annex.9", "14": "annex.10", "15": "annex.11", "16": "annex.12", "18": "annex.7"},
    "article_correspondence": {
        "NIS2 20 (governance)": {"BSIG": ["38"], "CBW": ["24"], "CBB": ["20", "21", "22"]},
        "NIS2 21 (risk-management measures)": {"BSIG": ["30", "31"], "CBW": ["21", "22", "23"], "CBB": ["5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19"]},
        "NIS2 23 (reporting)": {"BSIG": ["32", "35", "36"], "CBW": ["25", "26", "27", "28", "29", "30", "31", "32"], "CBB": ["23", "24", "25", "26"]},
        "NIS2 3(3)-(4), 27 (register / registration)": {"BSIG": ["33", "34"], "CBW": ["43", "44", "45", "47", "48"], "CBB": ["27"]},
        "NIS2 32-36 (supervision, fines)": {"BSIG": ["61", "62", "63", "64", "65"], "CBW": ["68", "69", "70", "71", "72", "73", "74", "75", "76", "77", "78", "79", "80", "81", "82", "83", "84", "85", "86", "87"]},
    },
    "chapter_links": chapter_links,
    "notes": ("Keys refer to provision keys in the regulation JSON files of this directory (reg = file 'code'). "
              "Chapters 1-13 follow the Annex of IR 2024/2690 (sections 1-13), which details NIS2 Art. 21(2)(a)-(j); "
              "BSIG § 30(2) Nr. 1-10 and Cbw art. 21(3)(a)-(j) transpose Art. 21(2)(a)-(j) one-to-one (verified against the texts). "
              "The Dutch Cyberbeveiligingsbesluit art. 6-18 follow the same 13 themes (Cbb art. 18 = effectiveness, art. 17 = alerts/threat intel feeding vulnerability handling). "
              "Chapter 13 links NIS2 Art. 21(2) intro (all-hazards approach incl. physical environment) because the IR Annex section 13 cites Art. 21(2)(c), (e) and (i). "
              "Chapter 17 (OT/production) combines Störfall-Verordnung duties (§ 3(2) Nr. 3 'Eingriffe Unbefugter', § 8 + Anhang III SMS, § 9 + Anhang II safety report) with § 30(1) BSIG and NIS2 Art. 21(1)/(2). "
              "ISO27001 links are informative (titles only)."),
}
json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("written", OUT)
