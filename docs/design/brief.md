# NIS2 Compass – design brief for a visual overhaul

## Product and users

NIS2 Compass is an internal compliance tool for a mid-sized manufacturing group: a headquarters and subsidiaries in
Germany and the Netherlands. The subsidiaries often have no IT department of their own, so many controls are
run centrally at HQ.

Users:
- **Information security officer (main user, daily):** runs the GAP assessment, the action plan, risks, controls,
  incidents and audits.
- **Local contacts per subsidiary (weekly):** answer assessment questions, upload evidence, work on their tasks.
- **Management board (monthly):** reads dashboards and reports, approves policies and risk acceptances.
- **Auditors (occasionally):** read-only.

The job of the UI is to show quickly **where each entity stands against every NIS-2 requirement, what is overdue,
and what closes the gap**. The tool must also produce evidence for authorities (BSI, NCSC/RDI) on request.

## Hard constraints (do not change)

- **Dense professional work tool, desktop first** (1280–1920 px). No marketing look, no oversized hero areas. Tables
  with 20–200 rows, forms with 10–20 fields, detail sheets next to lists.
- **Light and dark mode**, both first-class.
- **Accessibility:**
  - keyboard operation (the assessment workspace has shortcuts J/K and 1–4)
  - visible focus
  - contrast AA
  - status never shown by colour alone
- **Language:** English UI, but content contains long German/Dutch legal terms and references
  (e.g. "§ 30 Abs. 2 Nr. 1 BSIG", "Cyberbeveiligingsbesluit art. 17"). Layouts must wrap or truncate them gracefully.
- **Tech stack stays:**
  - React, Tailwind v4 with CSS variables as design tokens, shadcn/radix components, IBM Plex Sans/Mono (self-hosted)
  - A new typeface is possible if it is open-licensed and self-hostable.
- **Meaning of colour** (keep the semantics, the hues may change):
  - primary / compliant
  - target / gate
  - gap / alarm
  - warning / due soon
  - done / effective
  - a 6-step score scale from 0 (not implemented) to 5 (fully effective)

## Current design system (as synced to Claude Design)

Tokens in `frontend/src/index.css` ("petrol & brass"):
- **Surfaces:** fog background, white surfaces, graphite ink in 3 levels.
- **Colours:** petrol (primary/compliant), brass (targets/gates), alarm red (gaps), amber (warnings), sage (done).
- **Other:** 6-step score scale, dark sidebar, radius 6 px.

Building blocks:
- `PageHeader`, `Section` (bordered card with title bar)
- `Pill` / `StatusPill` / `PriorityPill`
- `Code` (mono identifiers)
- `KV` (label/value rows)
- `Stat` (KPI tile)
- `Empty` / `ErrorState` / `Loading`
- `OptionSelect`, `Combo`, `Segmented`, `ChipPicker`
- Dialogs, right-hand detail sheets, tabs, data tables with sortable headers and column chooser

## Recurring patterns to design once and reuse

1. **List + detail sheet:** filter bar, sortable dense table, row click opens a right-hand sheet with fields,
   history, comments and linked documents. Used for the action plan, risks, suppliers, controls, advisories and many
   more.
2. **Status and deadline display:**
   - status pill
   - due date with "overdue / due soon / on track"
   - countdown clocks for incident reporting (24 h / 72 h / 1 month)
3. **Entity context:**
   - entity tag (company code, e.g. ATL)
   - "group-wide" vs. entity-specific
   - "Central at HQ" answers
4. **Score and coverage:** score chips 0–5, coverage bars, chapter heat map (entities × 16 chapters).
5. **Legal references:** mono code + short title, linking to the regulations library.
6. **Approval (4-eyes) panel:** request, approver, decision, history.
7. **Forms in dialogs:** 2-column grids, pickers for users, roles, requirements and assets.
8. **Empty, loading and error states.**

## Screens (screenshots in `docs/design/screenshots/<light|dark>/`)

| # | Screen | Purpose | Priority |
|---|---|---|---|
| 00 | Login | Local login / SSO | low |
| 01 | Dashboard | Group status: coverage, scores by entity and chapter, overdue actions, incidents, project | **high** |
| 02 | My work | Everything assigned to me, grouped by urgency | **high** |
| 03–04 | Assessments, assessment workspace | 3 columns: chapters / requirements list / answer panel; the core daily screen | **high** |
| 05–06 | Requirements catalogue, requirement detail | 174 requirements, legal basis, check points | medium |
| 07–09 | Action plan, item sheet, bundle dialog | Remediation measures, owners, target dates | **high** |
| 10–13 | Project master plan (Gantt), work packages, detail, task board | Implementation project | medium |
| 14–16 | Documents, document detail, regulations library | Policies with versions and approvals; law texts | medium |
| 17–19 | Incidents, incident detail with reporting tracks, report draft | Significance wizard, 24 h / 72 h clocks, reports to authorities | **high** |
| 20 | Governance | Registrations, management board, trainings, obligations | medium |
| 21–23 | Audits & reviews | Programme, findings, effectiveness review (Cbb Art. 18), management review | medium |
| 24–25 | Risks, risk detail | Risk register, heat map, treatment, acceptance | medium |
| 26–29 | Controls calendar, advisories, vulnerabilities, KPIs | Recurring controls, threat information, KPI trends | medium |
| 30–35 | Approvals, suppliers, inventory, reports, data quality | Supporting registers and outputs | low |
| 36–37 | AI assistant, profile | Chat with citations; settings | low |

## Where the current UI is weakest (our own assessment)

- **Everything looks equally important:**
  - almost every block is the same bordered card with a title bar (`Section`)
  - the pages lack hierarchy between the "one thing to act on" and the reference information
- **Dashboard:** many tiles of equal weight; it does not answer "what needs my attention this week" at a glance.
- **Typography:** many ad-hoc sizes (11.5 / 12 / 12.5 / 13 / 13.5 px) instead of a defined type scale. Small text
  in dense tables is hard to scan.
- **Tables:** no zebra, row states, sticky headers or clear numeric alignment rules. Filters look different on each
  page.
- **Detail sheets and dialogs:** long vertical forms without grouping. Primary vs. secondary actions are not always
  clear.
- **Status colours:** used for pills, text, dots and bars in different ways; needs one consistent system (including
  dark mode contrast).
- **Navigation:** 25 entries in the sidebar. Needs grouping, collapsed state and a clearer "where am I" (breadcrumbs
  on detail pages).

## What we want from the overhaul

1. A revised design system:
   - tokens (colour, type scale, spacing, radius, elevation, both themes)
   - the components listed above
2. Redesigned high-priority screens: dashboard, my work, assessment workspace, action plan with sheet, incident
   detail.
3. One pattern each for: list + detail sheet, filter bar, form dialog, empty state.

Everything must stay implementable with the existing components (see the synced design system). New components are
fine if they are named and specified.
