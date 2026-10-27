import type { ProvisionNode, Regulation } from "@/lib/types"

export interface RegulationDetail {
  regulation: Regulation
  provisions: ProvisionNode[]
}

export interface ProvisionDetail {
  provision: { id: number; key: string; ref: string; heading: string | null; text: string | null; depth: number; regulation: Regulation }
  ancestors: { id: number; ref: string; heading: string | null }[]
  children: { id: number; ref: string; heading: string | null; text: string | null }[]
  requirements: {
    link_id: number
    relation: string
    direct: boolean
    is_auto: boolean
    requirement: { id: number; number: string; section: string; chapter: number; is_core: boolean }
    status: { entity_code: string; score: number | null; scope: string; implemented: string | null; assessment_id: number }[]
  }[]
  documents: { link_id: number; document_id: number; title: string; doc_type: string; status: string; version_label: string | null; filename: string | null; note: string | null }[]
}

export const KIND_LABEL: Record<string, string> = {
  eu_directive: "EU directive",
  eu_regulation: "EU regulation",
  national_law: "National law",
  national_ordinance: "National ordinance",
  standard: "Standard",
  internal_standard: "Internal standard",
  contract: "Contract",
  sector_rule: "Sector rule",
  guideline: "Guideline",
  other: "Other",
}

export const JURISDICTION_LABEL: Record<string, string> = {
  EU: "European Union",
  DE: "Germany",
  NL: "Netherlands",
  INT: "International",
}

export const LANGUAGE_LABEL: Record<string, string> = { en: "English", de: "German", nl: "Dutch", fr: "French" }

export function isStructural(n: ProvisionNode): boolean {
  return n.depth === 0 || !!(n.heading && n.heading.trim())
}

/** True when the library only holds titles, not the text (e.g. copyrighted standards such as ISO/IEC 27001). */
export function isTitlesOnly(reg: Regulation, provisions?: ProvisionNode[]): boolean {
  if (provisions && provisions.length) return provisions.every((p) => !p.text || !p.text.trim())
  return reg.kind === "standard"
}

/** Compact paragraph/point label for the reading view: "§ 30 Abs. 2" -> "(2)", "Art. 21(2)(a)" -> "(a)". */
export function shortLabel(ref: string): string {
  const r = ref.trim()
  let m: RegExpExecArray | null
  if ((m = /point\s+([\d.]+)$/.exec(r))) return m[1]
  if ((m = /Doppelbuchst\.\s*(\S+)$/.exec(r))) return `${m[1]})`
  if ((m = /Buchst\.\s*(\S+)$/.exec(r))) return `${m[1]})`
  if (/Spiegelstrich\s*\S+$/.test(r)) return "–"
  if ((m = /Nr\.\s*(\S+)$/.exec(r))) return `${m[1]}.`
  if ((m = /Abs\.\s*(\S+)$/.exec(r))) return `(${m[1]})`
  if ((m = /onderdeel\s+(\S+)$/.exec(r))) return `${m[1]}.`
  if (/streepje\s+\S+$/.test(r)) return "–"
  if ((m = /lid\s+(\S+)$/.exec(r))) return `${m[1]}.`
  if ((m = /(\([^()]+\))$/.exec(r))) return m[1]
  if ((m = /(Abschnitt\s+\S+)$/.exec(r))) return m[1]
  return r
}

export interface ProvisionTree {
  byId: Map<number, ProvisionNode>
  children: Map<number | null, ProvisionNode[]>
  /** Structural children only (chapters, articles, sections with headings). */
  tocChildren: Map<number | null, ProvisionNode[]>
  /** Requirement links in the node and all its descendants. */
  subtreeLinks: Map<number, number>
  /** Pre-order position of every node. */
  position: Map<number, number>
  /** Pre-order list. */
  order: ProvisionNode[]
  /** Structural nodes without structural children, in document order (used for previous / next). */
  leaves: ProvisionNode[]
  /** Common ref prefix to hide in the table of contents (e.g. "ISO/IEC 27001:2022, "). */
  tocPrefix: string | null
}

export function buildTree(provisions: ProvisionNode[]): ProvisionTree {
  const byId = new Map<number, ProvisionNode>()
  const children = new Map<number | null, ProvisionNode[]>()
  for (const p of provisions) byId.set(p.id, p)
  for (const p of provisions) {
    const parent = p.parent_id != null && byId.has(p.parent_id) ? p.parent_id : null
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent)!.push(p)
  }
  const order: ProvisionNode[] = []
  const walk = (pid: number | null) => {
    for (const c of children.get(pid) ?? []) {
      order.push(c)
      walk(c.id)
    }
  }
  walk(null)
  const position = new Map(order.map((n, i) => [n.id, i]))
  const subtreeLinks = new Map<number, number>()
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i]
    const own = (subtreeLinks.get(n.id) ?? 0) + n.links
    subtreeLinks.set(n.id, own)
    if (n.parent_id != null && byId.has(n.parent_id)) subtreeLinks.set(n.parent_id, (subtreeLinks.get(n.parent_id) ?? 0) + own)
  }
  const tocChildren = new Map<number | null, ProvisionNode[]>()
  for (const [pid, list] of children) {
    const s = list.filter(isStructural)
    if (s.length) tocChildren.set(pid, s)
  }
  const leaves = order.filter((n) => isStructural(n) && !tocChildren.has(n.id))
  // hide a long designation like "ISO/IEC 27001:2022, " when most top-level parts share it
  const tops = children.get(null) ?? []
  const counts = new Map<string, number>()
  for (const p of tops) {
    const i = p.ref.indexOf(", ")
    if (i > 0) counts.set(p.ref.slice(0, i + 2), (counts.get(p.ref.slice(0, i + 2)) ?? 0) + 1)
  }
  let tocPrefix: string | null = null
  for (const [k, v] of counts) if (v > tops.length / 2 && k.length > 8) tocPrefix = k
  return { byId, children, tocChildren, subtreeLinks, position, order, leaves, tocPrefix }
}

export function ancestorsOf(tree: ProvisionTree, id: number): ProvisionNode[] {
  const out: ProvisionNode[] = []
  let cur = tree.byId.get(id)
  while (cur && cur.parent_id != null) {
    const p = tree.byId.get(cur.parent_id)
    if (!p) break
    out.unshift(p)
    cur = p
  }
  return out
}

/** The section shown in the reading pane for a provision: itself if structural, else its nearest structural ancestor. */
export function displayRootOf(tree: ProvisionTree, id: number): ProvisionNode | null {
  let cur = tree.byId.get(id) ?? null
  while (cur && !isStructural(cur)) cur = cur.parent_id != null ? tree.byId.get(cur.parent_id) ?? null : null
  return cur
}

export function descendants(tree: ProvisionTree, id: number): ProvisionNode[] {
  const out: ProvisionNode[] = []
  const walk = (pid: number) => {
    for (const c of tree.children.get(pid) ?? []) {
      out.push(c)
      walk(c.id)
    }
  }
  walk(id)
  return out
}

export function lastDescendantPosition(tree: ProvisionTree, id: number): number {
  const d = descendants(tree, id)
  return d.length ? tree.position.get(d[d.length - 1].id)! : tree.position.get(id)!
}

export function tocRef(tree: ProvisionTree, ref: string): string {
  return tree.tocPrefix && ref.startsWith(tree.tocPrefix) ? ref.slice(tree.tocPrefix.length) : ref
}
