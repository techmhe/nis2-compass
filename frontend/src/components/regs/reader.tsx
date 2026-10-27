import { Fragment, useMemo } from "react"
import type { ProvisionNode } from "@/lib/types"
import { cn } from "@/lib/utils"
import { descendants, isStructural, type ProvisionTree, shortLabel } from "./model"
import { ProvisionDetails } from "./provision-details"

/**
 * Renders one section (chapter, article, §) with all descendants as a readable legal text: headings for
 * structural parts, numbered paragraphs and indented points. Text is shown as-is (German / Dutch originals).
 */
export function SectionReader({ tree, root, selectedId, onSelect, onClose, lang }: {
  tree: ProvisionTree
  root: ProvisionNode
  selectedId: number | null
  onSelect: (id: number) => void
  onClose: () => void
  lang: string
}) {
  const nodes = useMemo(() => [root, ...descendants(tree, root.id)], [tree, root])

  // indentation: number of non-structural ancestors between a node and the nearest structural one
  const indent = useMemo(() => {
    const m = new Map<number, number>()
    for (const n of nodes) {
      if (n.id === root.id || isStructural(n)) { m.set(n.id, 0); continue }
      const parent = n.parent_id != null ? tree.byId.get(n.parent_id) : undefined
      m.set(n.id, parent && !isStructural(parent) ? (m.get(parent.id) ?? 0) + 1 : 0)
    }
    return m
  }, [nodes, root, tree])

  return (
    <article lang={lang} className="max-w-[860px]">
      {nodes.map((n) => {
        const selected = n.id === selectedId
        // a section chosen in the contents only opens its link panel when something in it is linked
        const showDetails = selected && (n.id !== root.id || (tree.subtreeLinks.get(n.id) ?? 0) > 0)
        const details = showDetails ? <ProvisionDetails provisionId={n.id} onSelect={onSelect} onClose={onClose} /> : null
        const linkBadge = n.links > 0 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(n.id) }}
            className="tabular ml-2 inline-flex h-[18px] shrink-0 items-center rounded-[3px] bg-petrol-50 px-1.5 align-middle font-sans text-[11px] font-medium text-petrol hover:bg-petrol hover:text-white"
            aria-label={`${n.links} linked requirement${n.links === 1 ? "" : "s"} for ${n.ref}`}>
            {n.links} {n.links === 1 ? "requirement" : "requirements"}
          </button>
        )
        if (n.id === root.id || isStructural(n)) {
          const rel = n.depth - root.depth
          const Heading = rel === 0 ? "h2" : rel === 1 ? "h3" : "h4"
          return (
            <Fragment key={n.id}>
              <section id={`prov-${n.id}`} className={cn("scroll-mt-20", rel === 0 ? "mb-3" : "mt-6 mb-2")}>
                <Heading className={cn("flex flex-wrap items-baseline gap-x-2 text-ink",
                  rel === 0 ? "text-[18px] font-semibold" : rel === 1 ? "text-[15px] font-semibold" : "text-[14px] font-semibold")}>
                  <button type="button" onClick={() => onSelect(n.id)}
                    className={cn("rounded-[3px] font-mono font-medium hover:text-petrol", rel === 0 ? "text-[15px]" : "text-[13px]", selected ? "text-petrol" : "text-ink-2")}
                    aria-label={`Show links of ${n.ref}`}>{n.ref}</button>
                  <span>{n.heading}</span>
                  {linkBadge}
                </Heading>
                {n.text && <p className="prose-law mt-1.5">{n.text}</p>}
              </section>
              {details}
            </Fragment>
          )
        }
        const level = indent.get(n.id) ?? 0
        return (
          <Fragment key={n.id}>
            <div id={`prov-${n.id}`}
              className={cn("group grid scroll-mt-20 grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2 rounded-[4px] py-1 pr-2 -ml-2 pl-2",
                selected ? "bg-petrol-50/70 ring-1 ring-petrol/30" : n.links > 0 ? "hover:bg-muted/60" : "")}
              style={{ marginLeft: level * 24 - 8 }}>
              <button type="button" onClick={() => onSelect(n.id)} title={n.ref}
                className={cn("pt-[1px] text-right font-mono text-[12.5px] leading-[1.65] hover:text-petrol", selected ? "text-petrol" : "text-ink-3")}
                aria-label={`Select ${n.ref}`}>
                {shortLabel(n.ref)}
              </button>
              <div className="min-w-0">
                {n.heading && <div className="font-medium text-ink">{n.heading}</div>}
                {n.text ? <span className="prose-law">{n.text}</span> : !n.heading && <span className="text-[13px] text-ink-3 italic">No text</span>}
                {linkBadge}
              </div>
            </div>
            {details && <div style={{ marginLeft: level * 24 + 52 }}>{details}</div>}
          </Fragment>
        )
      })}
    </article>
  )
}
