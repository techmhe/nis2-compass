// Finish the component library build (npm run build:ds): make the emitted declarations self-contained by rewriting
// the "@/..." path alias to relative paths, and write the package manifest the design-sync converter reads.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"

const dist = new URL("../ds-dist/", import.meta.url).pathname
const types = join(dist, "types")

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".d.ts") ? [p] : []
  })
}

for (const file of walk(types)) {
  const src = readFileSync(file, "utf8")
  const out = src.replace(/(["'])@\/([^"']+)\1/g, (_, q, target) => {
    let rel = relative(dirname(file), join(types, target))
    if (!rel.startsWith(".")) rel = `./${rel}`
    return `${q}${rel}${q}`
  })
  if (out !== src) writeFileSync(file, out)
}

// Library mode inlines every font as a base64 data URI (1.4 MB of CSS for every design). Drop those @font-face rules;
// design-sync ships the IBM Plex files separately (cfg.extraFonts -> fonts/).
const cssPath = join(dist, "style.css")
const css = readFileSync(cssPath, "utf8")
let slim = css.replace(/@font-face\s*\{[^}]*url\(\s*["']?data:[^}]*\}/g, "")
console.log(`style.css: ${(css.length / 1024).toFixed(0)} KB -> ${(slim.length / 1024).toFixed(0)} KB without inlined fonts`)

// Claude Design builds its token list and theme switcher from the custom properties it finds in the stylesheet:
// declarations on :root-like selectors, "*" and single-class selectors. Tailwind's internals (--tw-*, --spacing,
// --text-*, ...) and every utility that sets one (.shadow-lg, .ring-petrol) end up there and crowd out the real theme.
// Move the theme (colours, --font-*, --radius*) into tokens.css and hide the rest from that scan without changing
// what renders: same values, same specificity.
function blockEnd(s, open) {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++
    else if (s[i] === "}" && --depth === 0) return i + 1
  }
  throw new Error("unbalanced braces in style.css")
}
function cut(re, what) {
  const m = re.exec(slim)
  if (!m) throw new Error(`style.css: ${what} not found - check ds-package.mjs against the current Tailwind output`)
  slim = slim.slice(0, m.index) + slim.slice(m.index + m[0].length)
  return m
}
const decls = (body) => body.split(";").map((d) => d.trim()).filter(Boolean)
const isToken = (d) => /^--(?:font-|radius|color-)/.test(d)

// @property fallback for browsers without @property support (pre-2023 Safari/Firefox); designs render in current ones.
const props = slim.indexOf("@layer properties{")
if (props < 0) throw new Error("style.css: @layer properties not found")
slim = slim.slice(0, props) + slim.slice(blockEnd(slim, slim.indexOf("{", props)))

const themeLayer = /@layer theme\{:root,:host\{([^{}]*)\}\}/.exec(slim)
if (!themeLayer) throw new Error("style.css: @layer theme block not found")
const tailwindTheme = decls(themeLayer[1])
const defaultFont = tailwindTheme.find((d) => d.startsWith("--default-font-family:"))
slim = slim.replace(themeLayer[0], "")
// Tailwind's own scale (--spacing, --text-*, --default-*, ...) is not part of the theme: inline its values so neither a
// token nor an unrecognised scope is left. The default font families point at the --font-* tokens instead.
const fontAlias = { "--default-font-family": "--font-sans", "--default-mono-font-family": "--font-mono" }
let inlined = 0
for (const d of tailwindTheme.filter((d) => !isToken(d))) {
  const [name, value] = [d.slice(0, d.indexOf(":")), d.slice(d.indexOf(":") + 1)]
  if (fontAlias[name]) {
    slim = slim.split(`var(${name},`).join(`var(${fontAlias[name]},`)
    continue
  }
  if (slim.includes(`var(${name},`)) throw new Error(`style.css: var(${name}, fallback) cannot be inlined`)
  slim = slim.split(`var(${name})`).join(value)
  inlined++
}

const light = cut(/(?<=\}):root\{([^{}]*--petrol:[^{}]*)\}/, "theme :root block")[1]
const dark = cut(/(?<=\})\.dark\{([^{}]*--petrol:[^{}]*)\}/, "theme .dark block")[1]
const rootTokens = [
  ...tailwindTheme.filter(isToken),
  ...(defaultFont && !tailwindTheme.some((d) => d.startsWith("--font-sans:"))
    ? [defaultFont.replace("--default-font-family", "--font-sans")] : []),
  ...decls(light),
]
writeFileSync(join(dist, "tokens.css"), `:root{${rootTokens.join(";")}}\n.dark{${decls(dark).join(";")}}\n`)

slim = slim.replace("@media print{:root,.dark{", "@media print{:is(:root,.dark){")
let hidden = 0
const singleClass = /^\.(?:\\.|[\w-])+$/
slim = slim.replace(/(?<=[{}])([^{}@;]+)\{(?=[^{}]*--[\w-]+:)/g, (all, list) => {
  const parts = list.split(",")
  if (!parts.some((p) => singleClass.test(p))) return all
  hidden++
  return `${parts.map((p) => (singleClass.test(p) ? `:is(${p})` : p)).join(",")}{`
})
writeFileSync(cssPath, slim)
console.log(`tokens.css: ${rootTokens.length} light / ${decls(dark).length} dark tokens; ${inlined} Tailwind theme vars inlined, ${hidden} utility rules hidden from the token scan`)

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version
writeFileSync(join(dist, "index.d.ts"), 'export * from "./types/design-system/index";\n')
writeFileSync(join(dist, "package.json"), JSON.stringify({
  name: "@nis2-compass/ui",
  version,
  private: true,
  type: "module",
  module: "./index.js",
  main: "./index.js",
  types: "./index.d.ts",
  style: "./style.css",
  exports: { ".": { types: "./index.d.ts", import: "./index.js" }, "./style.css": "./style.css" },
}, null, 2) + "\n")
console.log(`ds-dist ready (types rewritten under ${relative(process.cwd(), types)})`)
