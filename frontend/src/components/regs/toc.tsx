import { memo, useMemo, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import type { ProvisionNode } from "@/lib/types"
import { cn } from "@/lib/utils"
import { type ProvisionTree, tocRef } from "./model"

/** Collapsible table of contents over the structural provisions of one regulation. */
export const Toc = memo(function Toc({ tree, expanded, onToggle, activeId, onSelect, filter }: {
  tree: ProvisionTree
  expanded: Set<number>
  onToggle: (id: number) => void
  activeId: number | null
  onSelect: (id: number) => void
  filter: string
}) {
  // when filtering, show matching nodes and their ancestors, fully expanded
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return null
    const keep = new Set<number>()
    for (const n of tree.order) {
      const hay = `${n.ref} ${n.heading ?? ""}`.toLowerCase()
      if (!hay.includes(f)) continue
      let cur: ProvisionNode | undefined = n
      while (cur) {
        keep.add(cur.id)
        cur = cur.parent_id != null ? tree.byId.get(cur.parent_id) : undefined
      }
    }
    return keep
  }, [filter, tree])

  const render = (pid: number | null, level: number): ReactNode => {
    const items = (tree.tocChildren.get(pid) ?? []).filter((n) => !visible || visible.has(n.id))
    if (!items.length) return null
    return (
      <ul role={level === 0 ? "tree" : "group"} aria-label={level === 0 ? "Table of contents" : undefined}>
        {items.map((n) => {
          const hasKids = tree.tocChildren.has(n.id)
          const open = visible ? true : expanded.has(n.id)
          const links = tree.subtreeLinks.get(n.id) ?? 0
          const active = n.id === activeId
          return (
            <li key={n.id} role="treeitem" aria-expanded={hasKids ? open : undefined} aria-selected={active}>
              <div className={cn("group flex items-start rounded-[4px] pr-1", active ? "bg-petrol-50" : "hover:bg-muted")}
                style={{ paddingLeft: level * 12 }}>
                {hasKids ? (
                  <button type="button" onClick={() => onToggle(n.id)} aria-label={open ? `Collapse ${n.ref}` : `Expand ${n.ref}`}
                    className="mt-[3px] flex size-5 shrink-0 items-center justify-center rounded text-ink-3 hover:text-ink">
                    <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
                  </button>
                ) : <span className="w-5 shrink-0" />}
                <button type="button" id={`toc-${n.id}`} onClick={() => onSelect(n.id)}
                  className={cn("flex min-w-0 flex-1 items-baseline gap-1.5 py-[3px] text-left text-[12.5px] leading-snug", active ? "text-petrol" : "text-ink-2 hover:text-ink")}>
                  <span className={cn("shrink-0 font-mono text-[11.5px]", active ? "text-petrol" : "text-ink-3")}>{tocRef(tree, n.ref)}</span>
                  <span className={cn("min-w-0", level === 0 && "font-medium text-ink")}>{n.heading}</span>
                </button>
                {links > 0 && (
                  <span className="tabular mt-[3px] ml-1 shrink-0 rounded-[3px] bg-petrol-50 px-1 text-[10.5px] leading-4 text-petrol"
                    title={`${links} requirement link${links === 1 ? "" : "s"} in this part`}>{links}</span>
                )}
              </div>
              {hasKids && open && render(n.id, level + 1)}
            </li>
          )
        })}
      </ul>
    )
  }
  const out = render(null, 0)
  return out ?? <p className="px-2 py-3 text-[12.5px] text-ink-3">{filter ? "No heading matches this filter." : "This regulation has no contents yet."}</p>
})
