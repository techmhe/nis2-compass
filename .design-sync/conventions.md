## Conventions: NIS2 Compass

NIS2 Compass is a dense desktop compliance tool: tables, forms and detail panels for GAP assessments, action plans,
risks, incidents and audits. Designs should look like a calm work tool, not a marketing site.

### Setup

Wrap the whole design once in `DesignSystemProvider`. It applies the design tokens, IBM Plex Sans, the fog page
background, the light/dark theme (`theme="dark"`) and the tooltip and router context. Without it, Tooltip and
Markdown links fail and the page has no background.

```jsx
const { DesignSystemProvider, PageHeader, Section, Button, Icons, StatusPill, KeyValue } = window.Nis2Compass
<DesignSystemProvider theme="light">
  <main className="space-y-5 p-6">
    <PageHeader title="Action plan" description="Remediation measures for all GAP findings."
      actions={<Button><Icons.Plus /> New item</Button>} />
    <Section title="AP-005 Document the procedure">
      <KeyValue label="Status"><StatusPill value="In Progress" /></KeyValue>
      <KeyValue label="Target date">26 Sep 2026</KeyValue>
    </Section>
  </main>
</DesignSystemProvider>
```

Icons: use `Icons.<Name>` (the lucide icons the app uses, e.g. `Icons.Plus`, `Icons.Download`, `Icons.ShieldAlert`).
Sub-parts of compound components are exported alongside them: `DialogContent`, `SheetContent`, `TableRow`,
`TabsList`, `SelectTrigger` and so on.

### Styling

Styling uses Tailwind utility classes on top of CSS custom properties. The stylesheet is precompiled: only classes
the app already uses exist, and new arbitrary classes stay unstyled. Prefer the vocabulary below. For anything else,
use inline `style` with `var(--token)`.

| Purpose | Classes | Tokens |
|---|---|---|
| Surfaces | `bg-background` (fog page), `bg-card` (white panel), `bg-muted` | `--fog`, `--surface` |
| Text | `text-ink` (primary), `text-ink-2`, `text-ink-3` (muted) | `--ink`, `--ink-2`, `--ink-3` |
| Borders | `border` (uses `--line`), `divide-y`, `rounded-md` | `--line`, `--line-strong` |
| Meaning | `text-petrol` / `bg-petrol-50` = compliant, primary · `text-brass` / `bg-brass-50` = targets, gates · `text-alarm` / `bg-alarm-50` = gaps, overdue · `text-amber` / `bg-amber-50` = due soon · `text-sage` / `bg-sage-50` = done | same names as variables |
| Scores 0–5 | ScoreChip, ScoreBar | `--score-0` … `--score-5` |
| Type sizes | page title `text-[22px]`, body `text-[13.5px]`/`text-[13px]`, meta `text-[12.5px]`; identifiers `font-mono`; numbers `tabular` | |
| Layout | `space-y-5`, `gap-3`, `grid grid-cols-2`/`grid-cols-4`, `px-4 py-2` | |

Use colour for meaning only, never for decoration. Show status with a component, not with raw colour:
- `StatusPill value="Overdue"` for statuses
- `PriorityPill` for priorities
- `Pill tone="alarm|amber|petrol|brass|sage|neutral|outline"` for custom labels
- `EntityTag code="ATN"` for the entities ATL, ATS, ATN and ATC
- `Code` for requirement numbers such as `1.1.1` and legal references such as `§ 30 Abs. 2 Nr. 1 BSIG`

### Page patterns

- **Page:** `PageHeader` (title, description, actions), then content blocks.
- **Content blocks:**
  - `Section` is a bordered card with a title bar and `actions`; use `bodyClassName="p-0"` for tables or lists.
  - `Card` is for standalone cards.
- **KPI row:** `Stat` tiles in a `grid`.
- **Details:** `KeyValue` rows inside a Section or Sheet.
- **Lists:** `Table` with `TableHeader`/`TableRow`/`TableCell`.
- **Selection and details:** a row opens a right-hand `Sheet` with the details.
- **Forms:** `Field` (label, hint) around `Input`, `Textarea`, `OptionSelect`, `Combo`, `Segmented` or
  `ChipPicker`, laid out in a 2-column grid inside a `Dialog`.
- **States:** `Loading`, `Empty` (title, text, action), `ErrorState`, `Skeleton`.

### Where the truth lives

- `styles.css` and its imports contain the tokens and every available class.
- Each component's `.prompt.md` shows real usage.
- Each component's `.d.ts` is its prop contract.
