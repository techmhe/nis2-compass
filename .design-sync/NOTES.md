# design-sync notes (NIS2 Compass)

## Setup
- The repo is an app, not a published package. The component library is built by `npm --prefix frontend run build:ds`
  (vite library build of `frontend/src/design-system/index.ts` -> `frontend/ds-dist/`, plus `tsc -p tsconfig.ds.json`
  declarations and `frontend/scripts/ds-package.mjs`, which rewrites the `@/` path alias in the .d.ts files, writes
  `ds-dist/package.json` and strips the base64 fonts vite inlines in library mode).
- Converter: `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules frontend/node_modules --entry frontend/ds-dist/index.js --out ./ds-bundle`
- Browser: no Playwright chromium download; use the local Chrome:
  `DS_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` for package-validate/package-capture.
  Playwright is installed in `.ds-sync/` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
- Fonts: IBM Plex Sans/Mono ship via `cfg.extraFonts` from `frontend/node_modules/@fontsource/*` (the inlined copies are
  stripped from style.css, 1.4 MB -> 125 KB).

## Component set
- Only presentational components are exported. Data-bound ones (UserSelect, StakeholderSelect, EntitySelect,
  CommentsPanel, DocumentLinks, UploadDialog, AbsenceSettings) and the sonner Toaster (needs the app ThemeProvider)
  are left out on purpose.
- Sub-part exports (DialogContent, TableRow, ...) are in the bundle but excluded from cards via `componentSrcMap: null`;
  their usage is shown in the root component's preview.
- `KV` is exported a second time as `KeyValue`, because all-caps names are treated as constants by the converter.
- `Icons` is a namespace export of the lucide icons the app uses (`frontend/src/design-system/icons.ts`); regenerate
  the list when the app starts using new icons.
- Groups come from category stubs in `.design-sync/docs/<Name>.md` (frontmatter only). A component whose src file sits
  in a non-generic folder (e.g. `common/`) keeps that folder as group - that's why ChipPicker moved to `components/ui/`.
- `DesignSystemProvider` (cfg.provider) supplies the tokens/theme (`theme="dark"` switches), TooltipProvider and a
  MemoryRouter (Markdown renders internal links with react-router's Link).

## Preview authoring
- Previews import from "@nis2-compass/ui"; lucide-react icons may be imported directly in previews, but designs should
  use `Icons.<Name>` from the bundle.
- Use realistic NIS2 content (entities ATL, ATS, ATN, ATC; action plan codes AP-001; requirement numbers 1.1.1; incident
  INC-004; German/Dutch legal references like "§ 30 Abs. 2 Nr. 1 BSIG").
- Overlays (Dialog, AlertDialog, Sheet, Popover, Tooltip, HoverCard, DropdownMenu, Confirm) render open via
  `defaultOpen`/`open` and use `cardMode: single` with a 900x620 viewport.
- `Confirm` has no open/defaultOpen prop (uncontrolled wrapper around AlertDialog). Its preview composes the open
  state from AlertDialog parts (primary story) and shows the real `<Confirm>` closed with its trigger.
- Previews must not load remote images or name real people: use inline data-URI images and the demo personas
  (Isabel Schmidt, isb@demo.local, ...).

## Known render warns
- none recorded yet

## Token list (Claude Design)
- Claude Design builds its token list and theme switcher from custom properties on :root-like, `*` and single-class
  selectors across the whole styles.css closure. Tailwind's `--tw-*` helpers, its theme variables (`--spacing`,
  `--text-*`, ...) and utilities like `.shadow-lg` used to fill that list; the real theme sat at ~111 KB into
  `_ds_bundle.css` and was not picked up (two warnings in the project, 2026-09-30).
- Fix in `frontend/scripts/ds-package.mjs`: the theme (colours, `--font-*`, `--radius*`, light + plain `.dark`) goes to
  `ds-dist/tokens.css` under a plain `:root`, shipped via `cfg.tokensPkg: "../ds-dist"` + `tokensGlob` and imported
  first. Tailwind's own scale (`--spacing`, `--text-*`, `--default-*`, ...) is inlined as literal values (the
  `@layer theme` block is gone; the default font families point at `--font-sans`/`--font-mono`). Single-class utility
  rules that set `--tw-*` are wrapped in `:is(...)` (same specificity) so they don't register as token scopes or themes,
  and the `@layer properties` fallback for browsers without `@property` is dropped. Verified: previews unchanged
  (diffs only from animation timing / the calendar's "today"); `_ds_manifest.json` lists only the theme tokens and one
  theme ("Dark").
- Not fixable from the repo: Claude Design's "Check design system" still reports Tailwind's `--tw-*` helpers declared on
  utility classes (`.border-spacing-0`, `.-translate-x-1/2`, `.space-y-*`, ...) as unregistered variables. They are how
  Tailwind composes utilities and must stay; skipping them is up to Claude Design's own token reader (2026-10-01).

## Re-sync risks
- `frontend/src/design-system/icons.ts` is a static list: regenerate it when the app starts using new lucide icons.
- The stylesheet only contains Tailwind classes the app itself uses. If the app drops classes that
  `.design-sync/conventions.md` names (e.g. `text-[13.5px]`, `space-y-5`), re-validate the conventions table.
- `frontend/scripts/ds-package.mjs` strips data-URI `@font-face` rules with a regex tied to vite's library-mode
  output; check `_ds_bundle.css` stays ~125 KB after vite upgrades.
- The Calendar preview pins September 2026 (`defaultMonth`); fine as a static example, but dated.
- `DS_CHROMIUM_PATH` points at the macOS Chrome app; set it for the machine running the sync.
- `ds-package.mjs` throws if Tailwind's output no longer has `@layer properties`, `@layer theme{:root,:host{`, a
  `var(--x, fallback)` it cannot inline, or the
  unlayered `:root{...--petrol...}` / `.dark{...}` blocks; adjust the regexes after Tailwind upgrades. After a sync,
  check `_ds_manifest.json` in the project (`tokens`, `themes`) for `--tw-*` entries.
- Re-sync: `npm --prefix frontend run build:ds`, then the resync driver with `--entry frontend/ds-dist/index.js` and
  `--remote .design-sync/.cache/remote-sync.json` (fetch `_ds_sync.json` from the project first).
