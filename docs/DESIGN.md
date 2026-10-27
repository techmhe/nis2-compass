# Design

The tokens live in `frontend/src/index.css` ("petrol & brass") and are the truth; this page explains how to use
them. `docs/design/brief.md` describes the users, the screens and the known weak spots.

## Feel

Dense, calm, precise, professional. A desktop-first work tool (1280–1920 px) for tables with 20–200 rows, forms with
10–20 fields and detail sheets next to lists. No marketing look and no oversized hero areas.

## Colors

Use the Tailwind classes generated from the tokens (`bg-petrol`, `text-ink-2`, `border-line`, ...), never raw hex
values in components. Light and dark mode are both first-class; the `.dark` block redefines every token.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `fog` (`background`) | `#f2f4f3` | `#0e1317` | page background |
| `surface` (`card`, `popover`) | `#ffffff` | `#151c21` | cards, panels, dialogs |
| `ink` / `ink-2` / `ink-3` | `#1b2230` / `#4a5363` / `#7b8493` | `#e4e8ea` / `#b3bcc3` / `#85909a` | body / secondary / muted text |
| `line` / `line-strong` | `#dde2e0` / `#c7cecb` | `#26313a` / `#34414b` | borders / input borders |
| `petrol` (`primary`, `ring`) | `#0d6770` | `#3fb0b8` | primary actions, focus, compliant |
| `brass` | `#a87b22` | `#d4a54a` | targets, gates |
| `alarm` (`destructive`) | `#b42318` | `#f07065` | gaps, errors, destructive actions |
| `amber` | `#b86e00` | `#e6a23c` | warnings, due soon |
| `sage` | `#3f7d4e` | `#6fbf82` | done, effective |
| `score-0` … `score-5` | `#b42318` … `#0d6770` | `#f07065` … `#3fb0b8` | maturity score, 0 = not implemented, 5 = fully effective |
| `sidebar*` | `#1b2230` | `#0b1014` | the sidebar is dark in both themes |

Every status hue has a `-50` tint (`petrol-50`, `brass-50`, `alarm-50`, `amber-50`, `sage-50`) for pill and row
backgrounds. The meaning of a colour is fixed: do not use `alarm` for emphasis or `sage` for decoration.

## Typography

- IBM Plex Sans for text, IBM Plex Mono for identifiers, requirement ids and legal references (`font-mono`, the
  `Code` component). Both are self-hosted; a new typeface must be open-licensed and self-hostable.
- Content contains long German and Dutch legal terms ("§ 30 Abs. 2 Nr. 1 BSIG", "Cyberbeveiligingsbesluit art. 17").
  Layouts must wrap or truncate them.

## Spacing

- Radius: `--radius` is 6 px; use `rounded-sm` / `rounded-md` / `rounded-lg` / `rounded-xl` (4 / 6 / 8 / 12 px).
- Spacing follows the Tailwind scale. Tables and forms stay dense.

## Components

Reuse the shared building blocks before writing new ones: `src/components/common/` (`basics`, `fields`,
`ChipPicker`, ...) and `src/components/ui/` (shadcn/radix).

- Page frame: `PageHeader`, `Section` (bordered card with title bar); every page is wrapped in `PageErrorBoundary`.
- Status: `Pill`, `StatusPill`, `PriorityPill`; score chips 0–5.
- Data: `KV` (label/value rows), `Stat` (KPI tile), `Code`, data tables with sortable headers and column chooser.
- Input: `OptionSelect`, `Combo`, `Segmented`, `ChipPicker`; forms in dialogs use 2-column grids.
- States: `Empty`, `ErrorState`, `Loading`.
- List + detail: filter bar, dense sortable table, row click opens a right-hand sheet.

## Do / Don't

- Do: keep both themes working, keep focus visible, keep contrast at AA, keep keyboard operation (the assessment
  workspace uses J/K and 1–4).
- Do: add a Playwright test in `frontend/e2e/` for UI flows and layout.
- Don't: show status by colour alone; pair it with a label or an icon.
- Don't: change the shrinkable grid column in `components/ui/dialog.tsx`; long unwrapped content otherwise pushes
  dialogs past their border (the e2e `expectDialogFits` check guards this).
- Don't: introduce ad-hoc font sizes or hex colours in components.
