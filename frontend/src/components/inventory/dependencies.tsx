import { useMemo, useState } from "react"
import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, GitBranch, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Code, Empty, EntityTag, ErrorState, Loading, Pill } from "@/components/common/basics"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { CritPill, EntityFilter, fmtHours, LifecyclePill, TierPill, useInventoryMeta, useOpenSheet, useParam, type AssetBrief, type SupplierBrief } from "./shared"
import type { EntityBrief } from "@/lib/types"

interface DepTree {
  services: {
    id: number; code: string; name: string; entity: EntityBrief | null; criticality: number; kind: string
    rto_hours: number | null; rpo_hours: number | null
    assets: ((AssetBrief & { hidden: false }) | { id: number; code: string; name: string; hidden: true })[]
    suppliers: SupplierBrief[]
  }[]
  unlinked_assets: AssetBrief[]
}

function SupplierLink({ s }: { s: SupplierBrief }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Link to={`/suppliers/${s.id}`} className="text-ink hover:text-petrol">{s.name}</Link>
      <TierPill tier={s.tier} />
      {s.status === "offboarded" && <Pill tone="alarm">Offboarded</Pill>}
    </span>
  )
}

export function DependenciesTab() {
  const meta = useInventoryMeta()
  const openSheet = useOpenSheet()
  const [entity, setEntity] = useParam("entity")
  const [q, setQ] = useState("")
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const tree = useQuery({
    queryKey: ["inv", "dependencies", entity],
    queryFn: () => api.get<DepTree>("/inventory/dependencies", { entity_id: entity ?? undefined }),
  })
  const services = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (tree.data?.services ?? []).filter((s) => !needle || [s.code, s.name, ...s.assets.map((a) => `${a.code} ${a.name} ${"supplier" in a && a.supplier ? a.supplier.name : ""}`), ...s.suppliers.map((x) => x.name)]
      .join(" ").toLowerCase().includes(needle))
  }, [tree.data, q])
  const toggle = (id: number) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allIds = services.map((s) => s.id)

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[300px] min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find service, asset or supplier" className="pl-8" aria-label="Search dependencies" />
        </div>
        <EntityFilter value={entity} onChange={setEntity} />
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set())}>Expand all</Button>
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set(allIds))}>Collapse all</Button>
        </div>
      </div>
      <div className="rounded-md border bg-card">
        {tree.isLoading ? <Loading /> : tree.error ? <ErrorState error={tree.error} className="m-4" /> : services.length === 0 ? (
          <Empty title={q ? "Nothing matches this search" : "No services to show"} icon={<GitBranch className="size-6" />}>
            {q ? "Search for another service, asset or supplier." : "Record services and link their supporting assets to see the dependency chain."}
          </Empty>
        ) : (
          <ul role="tree" aria-label="Service dependencies" className="divide-y">
            {services.map((s) => {
              const open = !collapsed.has(s.id)
              return (
                <li key={s.id} role="treeitem" aria-expanded={open} className="px-4 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="rounded-[3px] p-0.5 text-ink-3 hover:bg-muted hover:text-ink" onClick={() => toggle(s.id)} aria-label={open ? `Collapse ${s.name}` : `Expand ${s.name}`}>
                      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                    <Code>{s.code}</Code>
                    <button className="text-left text-[13.5px] font-medium text-ink hover:text-petrol" onClick={() => openSheet("service", s.id)}>{s.name}</button>
                    {s.entity ? <EntityTag code={s.entity.code} name={s.entity.name} /> : <span className="text-[12px] text-ink-3">Group</span>}
                    <CritPill value={s.criticality} />
                    <span className="tabular ml-auto text-[12px] text-ink-3">RTO {fmtHours(s.rto_hours)}, RPO {fmtHours(s.rpo_hours)}</span>
                    <span className="tabular text-[12px] text-ink-3">{s.assets.length} assets, {s.suppliers.length + new Set(s.assets.flatMap((a) => (!a.hidden && a.supplier ? [a.supplier.id] : []))).size} suppliers</span>
                  </div>
                  {open && (
                    <ul role="group" className="mt-1.5 ml-[11px] space-y-1 border-l pl-5">
                      {s.assets.length === 0 && s.suppliers.length === 0 && <li className="text-[12.5px] text-amber">No supporting assets or suppliers recorded.</li>}
                      {s.assets.map((a) => (
                        <li key={a.id} role="treeitem" className="relative text-[13px]">
                          <span className="absolute top-2.5 -left-5 w-4 border-t" aria-hidden />
                          {a.hidden ? (
                            <span className="text-ink-3">Asset of another entity (no access)</span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <Code>{a.code}</Code>
                              <button className="text-left text-ink hover:text-petrol" onClick={() => openSheet("asset", a.id)}>{a.name}</button>
                              <span className="text-[12px] text-ink-3">{meta.data?.asset_types[a.asset_type] ?? a.asset_type}</span>
                              {a.criticality != null && <CritPill value={a.criticality} />}
                              {a.lifecycle !== "in_operation" && <LifecyclePill value={a.lifecycle} label={meta.data?.lifecycle[a.lifecycle]} />}
                              {a.supplier && (
                                <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3">
                                  <span>supplied by</span><SupplierLink s={a.supplier} />
                                </span>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                      {s.suppliers.map((x) => (
                        <li key={`s${x.id}`} role="treeitem" className={cn("relative flex flex-wrap items-center gap-2 text-[13px]")}>
                          <span className="absolute top-2.5 -left-5 w-4 border-t" aria-hidden />
                          <Code>{x.code}</Code><SupplierLink s={x} /><span className="text-[12px] text-ink-3">direct supplier dependency</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {tree.data && tree.data.unlinked_assets.length > 0 && (
        <section className="mt-5 rounded-md border bg-card">
          <header className="border-b px-4 py-2.5">
            <h2 className="text-[13.5px] font-semibold text-ink">Assets not linked to a service ({tree.data.unlinked_assets.length})</h2>
            <p className="text-[12.5px] text-ink-3">Link them to the services they support, or retire them if they are no longer used.</p>
          </header>
          <ul className="divide-y">
            {tree.data.unlinked_assets.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-1.5 text-[13px]">
                <Code>{a.code}</Code>
                <button className="text-left text-ink hover:text-petrol" onClick={() => openSheet("asset", a.id)}>{a.name}</button>
                {a.entity && <EntityTag code={a.entity.code} name={a.entity.name} />}
                <span className="text-[12px] text-ink-3">{meta.data?.asset_types[a.asset_type] ?? a.asset_type}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
