"""Server-side PDF rendering of the management report (reportlab, no system libraries needed)."""

import io
from datetime import date
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

INK = colors.HexColor("#1b2230")
INK3 = colors.HexColor("#6b7482")
LINE = colors.HexColor("#dde2e0")
FOG = colors.HexColor("#f2f4f3")
PETROL = colors.HexColor("#0d6770")
ALARM = colors.HexColor("#b42318")

_base = getSampleStyleSheet()
H1 = ParagraphStyle(
    "h1",
    parent=_base["Heading1"],
    fontName="Helvetica-Bold",
    fontSize=17,
    leading=21,
    textColor=INK,
    spaceAfter=2,
)
H2 = ParagraphStyle(
    "h2",
    parent=_base["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=11.5,
    leading=14,
    textColor=INK,
    spaceBefore=10,
    spaceAfter=4,
)
BODY = ParagraphStyle(
    "body",
    parent=_base["BodyText"],
    fontName="Helvetica",
    fontSize=8.8,
    leading=11.5,
    textColor=INK,
    alignment=TA_LEFT,
)
META = ParagraphStyle("meta", parent=BODY, textColor=INK3, fontSize=8.2)
CELL = ParagraphStyle("cell", parent=BODY, fontSize=8.2, leading=10.2)


def _pct(v) -> str:
    return "–" if v is None else f"{v * 100:.0f}%"


def _p(text, style=CELL) -> Paragraph:
    return Paragraph(escape("" if text is None else str(text)), style)


def _table(rows: list[list], widths: list[float], header: bool = True) -> Table:
    t = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8.2),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), FOG), ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8)]
    t.setStyle(TableStyle(style))
    return t


def render_management_pdf(data: dict, generated_by: str) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=15 * mm,
        bottomMargin=16 * mm,
        title=data["title"],
        author=generated_by,
    )
    width = A4[0] - 32 * mm
    story: list = [
        Paragraph(escape(data["title"]), H1),
        Paragraph(
            escape(
                f"Assessment round {data['round']['name']}. Generated {data['generated_at']} by "
                f"{generated_by}."
            ),
            META,
        ),
        Spacer(1, 6),
    ]
    t = data["totals"]
    ap = data["action_plan"]
    kpis = [
        ["Assessment coverage", "Average score", "Findings", "Overdue actions"],
        [_pct(t["coverage"]), _pct(t["average_score"]), str(t["work_packages"]), str(ap["overdue"])],
        [
            _p(f"{t['assessed']} of {t['in_scope']} answers", META),
            _p("target 75% (ch. 14–16: 100%)", META),
            _p(f"{ap['unplanned_findings']} not yet in the action plan", META),
            _p(f"of {ap['total']} action plan items", META),
        ],
    ]
    kt = _table(kpis, [width / 4] * 4)
    kt.setStyle(
        TableStyle(
            [
                ("FONT", (0, 1), (-1, 1), "Helvetica-Bold", 13),
                ("LINEBELOW", (0, 1), (-1, 1), 0, colors.white),
                ("TEXTCOLOR", (3, 1), (3, 1), ALARM if ap["overdue"] else INK),
            ]
        )
    )
    story.append(kt)

    story.append(Paragraph("Entities", H2))
    story.append(
        _table(
            [["Entity", "Coverage", "Average score", "Findings", "Status"]]
            + [
                [
                    _p(f"{e['name']} ({e['code']})"),
                    _pct(e["coverage"]),
                    _pct(e["average_score"]),
                    str(e["work_packages"]),
                    _p(e["status"].replace("_", " ")),
                ]
                for e in data["entities"]
            ],
            [width * 0.4, width * 0.14, width * 0.16, width * 0.12, width * 0.18],
        )
    )

    gaps = [c for c in data["chapters"] if (c["gap_to_target"] or 0) > 0][:10]
    story.append(Paragraph("Largest gaps to chapter target", H2))
    if gaps:
        story.append(
            _table(
                [["Chapter", "Target", "Group average", "Gap", "Findings"]]
                + [
                    [
                        _p(f"{c['chapter']} {c['title']}"),
                        _pct(c["target"]),
                        _pct(c["group_average"]),
                        _pct(c["gap_to_target"]),
                        str(c["work_packages"]),
                    ]
                    for c in gaps
                ],
                [width * 0.52, width * 0.1, width * 0.14, width * 0.1, width * 0.14],
            )
        )
    else:
        story.append(Paragraph("All assessed chapters meet their target.", BODY))

    story.append(Paragraph("Overdue action plan items", H2))
    items = ap.get("overdue_items") or []
    if items:
        story.append(
            _table(
                [["Code", "Entity", "Measure", "Priority", "Responsible", "Target date"]]
                + [
                    [
                        i["code"],
                        i["entity"],
                        _p(i["title"]),
                        i["priority"],
                        _p(i["responsible"] or "–"),
                        str(i["target_date"] or "–"),
                    ]
                    for i in items
                ],
                [width * 0.09, width * 0.08, width * 0.43, width * 0.1, width * 0.17, width * 0.13],
            )
        )
    else:
        story.append(Paragraph("No overdue items.", BODY))

    blocks = []
    if data.get("project"):
        p = data["project"]
        rows = [["Gate", "Decision", "Planned", "Status"]] + [
            [g["code"], _p(g["decision"] or ""), str(g["planned_date"] or "–"), g["status"]]
            for g in p["gates"][:6]
        ]
        blocks.append(
            KeepTogether(
                [
                    Paragraph(
                        escape(
                            f"{p['name']}: {_pct(p['progress'])} progress, "
                            f"{p['completed']} of {p['total']} activities completed"
                        ),
                        H2,
                    ),
                    _table(rows, [width * 0.1, width * 0.6, width * 0.14, width * 0.16]),
                ]
            )
        )
    if data.get("incidents"):
        i = data["incidents"]
        blocks.append(
            KeepTogether(
                [
                    Paragraph("Incidents (last 12 months)", H2),
                    Paragraph(
                        escape(
                            f"{i['last_12_months']} recorded, {i['significant']} significant, early warning within 24 h for "
                            f"{i['early_warning_on_time']} of {i['significant']}, {i['open']} open."
                        ),
                        BODY,
                    ),
                ]
            )
        )
    if data.get("documents"):
        d = data["documents"]
        blocks.append(
            KeepTogether(
                [
                    Paragraph("Policies and documents", H2),
                    Paragraph(
                        escape(
                            f"{d['total']} documents, {d['review_overdue']} with overdue review, {d['policies_not_approved']} "
                            f"policies or procedures not yet approved."
                        ),
                        BODY,
                    ),
                ]
            )
        )
    for s in (data.get("sections") or {}).values():
        lines = "; ".join(f"{it['label']}: {it['value']}" for it in s.get("items", []))
        blocks.append(
            KeepTogether([Paragraph(escape(s.get("title", "")), H2), Paragraph(escape(lines), BODY)])
        )
    story += blocks

    if len(data.get("trend") or []) > 1:
        story.append(Paragraph("Progress over assessment rounds", H2))
        story.append(
            _table(
                [["Round", "Coverage", "Average score"]]
                + [[_p(r["round"]), _pct(r["coverage"]), _pct(r["average_score"])] for r in data["trend"]],
                [width * 0.6, width * 0.2, width * 0.2],
            )
        )

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(INK3)
        canvas.drawString(16 * mm, 9 * mm, f"NIS2 Compass – {data['title']} – {date.today().isoformat()}")
        canvas.drawRightString(A4[0] - 16 * mm, 9 * mm, f"Page {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
