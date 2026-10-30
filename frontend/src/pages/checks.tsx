import { useMemo, useState } from "react"
import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, CircleCheck, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Code, ErrorState, Loading, PageHeader, Pill } from "@/components/common/basics"
import { OptionSelect } from "@/components/common/fields"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

interface CheckRule {
  code: string
  area: string
  severity: "high" | "medium" | "low"
  title: string
  hint: string
  count: number
  items: { label: string; message: string; url: string | null; entity_id: number | null }[]
}

const SEV_TONE = { high: "alarm", medium: "amber", low: "neutral" } as const

export default function ChecksPage() {
  const q = useQuery({ queryKey: ["checks"], queryFn: () => api.get<{ rules: CheckRule[]; total: number }>("/checks") })
  const { data: entities = [] } = useEntities()
  const [entity, setEntity] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const rules = useMemo(() => (q.data?.rules ?? []).map((r) => {
    const items = entity ? r.items.filter((i) => i.entity_id === Number(entity) || i.entity_id == null) : r.items
    return { ...r, items, count: entity ? items.length : r.count }
  }), [q.data, entity])
  const areas = [...new Set(rules.map((r) => r.area))]
  const failing = rules.filter((r) => r.count > 0)

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Data quality"
        description="Plausibility checks across assessments, action plan, project and documents. Each finding links to the place where it can be fixed."
        actions={<Button variant="outline" data-tour="quality.run" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className={cn(q.isFetching && "animate-spin")} /> Run again</Button>}
      />
      <div data-tour="quality.filter" className="mb-4 flex items-center gap-3">
        <div className="w-72">
          <OptionSelect value={entity} onChange={setEntity} allowNone noneLabel="All entities" placeholder="All entities"
            options={entities.map((e) => ({ value: String(e.id), label: `${e.code} ${e.name}` }))} />
        </div>
        {q.data && (
          <span className="text-[13px] text-ink-3">
            {failing.length === 0 ? "No issues found." : `${failing.reduce((n, r) => n + r.count, 0)} issues in ${failing.length} checks.`}
          </span>
        )}
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : (
        <div data-tour="quality.rules" className="space-y-6">
          {areas.map((area) => (
            <section key={area}>
              <h2 className="mb-2 text-[13.5px] font-semibold text-ink">{area}</h2>
              <ul className="overflow-hidden rounded-md border bg-card">
                {rules.filter((r) => r.area === area).map((r) => {
                  const isOpen = open[r.code] ?? false
                  return (
                    <li key={r.code} className="border-b last:border-0">
                      <button className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent"
                        disabled={r.count === 0} onClick={() => setOpen((o) => ({ ...o, [r.code]: !isOpen }))} aria-expanded={isOpen}>
                        <span className="mt-0.5 text-ink-3">
                          {r.count === 0 ? <CircleCheck className="size-4 text-sage" /> : isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <Code className="text-ink-3">{r.code}</Code>
                            <span className={cn("text-[13.5px]", r.count === 0 ? "text-ink-3" : "font-medium text-ink")}>{r.title}</span>
                          </span>
                          <span className="block text-[12.5px] text-ink-3">{r.hint}</span>
                        </span>
                        {r.count > 0 && <Pill tone={SEV_TONE[r.severity]}>{r.count}</Pill>}
                      </button>
                      {isOpen && (
                        <ul className="border-t bg-muted/30 py-1">
                          {r.items.map((it, i) => (
                            <li key={i} className="flex items-baseline gap-3 px-11 py-1.5 text-[13px]">
                              {it.url ? <Link to={it.url} className="min-w-0 flex-1 truncate text-ink hover:text-petrol">{it.label}</Link>
                                : <span className="min-w-0 flex-1 truncate">{it.label}</span>}
                              <span className="shrink-0 text-[12.5px] text-ink-3">{it.message}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
