import { useMemo, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Download, Plus, Settings2, ShieldAlert, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Code, Empty, EntityTag, ErrorState, Loading, PageHeader, Pill, Section, Stat } from "@/components/common/basics"
import { OptionSelect } from "@/components/common/fields"
import { ApprovalStatePill } from "@/components/approvals/shared"
import { LevelLegend, RiskHeatMap } from "@/components/risks/heat-map"
import { MethodSheet } from "@/components/risks/method-sheet"
import { NewRiskDialog } from "@/components/risks/new-risk-dialog"
import {
  LEVEL_LABEL, LEVELS, LevelPill, RiskStatusPill, STATUS_LABEL, TREATMENT_LABEL, useRiskMeta, type Heatmap, type Risk, type RiskStatus,
} from "@/components/risks/shared"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api, download, qs } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { cn } from "@/lib/utils"

type Basis = "inherent" | "residual"
type SortKey = "code" | "inherent" | "residual" | "review"

export default function RisksPage() {
  const { canAny } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const entities = useEntities()
  const meta = useRiskMeta()
  const [scope, setScope] = useState<string | null>(params.get("entity"))
  const [status, setStatus] = useState<string | null>(params.get("status"))
  const [treatment, setTreatment] = useState<string | null>(null)
  const [mine, setMine] = useState(params.get("mine") === "1")
  const [overdue, setOverdue] = useState(params.get("overdue") === "1")
  const [aboveAppetite, setAboveAppetite] = useState(false)
  const [q, setQ] = useState("")
  const [basis, setBasis] = useState<Basis>("residual")
  const [cell, setCell] = useState<{ l: number; i: number } | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "residual", desc: true })
  const [newOpen, setNewOpen] = useState(false)
  const [methodOpen, setMethodOpen] = useState(false)

  const filters = {
    entity_id: scope && scope !== "group" ? Number(scope) : undefined,
    group: scope === "group" ? true : undefined,
    status: status ? [status] : undefined,
    treatment: treatment ?? undefined,
    mine: mine || undefined,
    review_overdue: overdue || undefined,
    above_appetite: aboveAppetite || undefined,
    q: q.trim() || undefined,
  }
  const heat = useQuery({
    queryKey: ["risks", "heatmap", filters],
    queryFn: () => api.get<Heatmap>("/risks/heatmap", filters),
    placeholderData: keepPreviousData,
  })
  const list = useQuery({
    queryKey: ["risks", "list", filters, basis, cell],
    queryFn: () => api.get<Risk[]>("/risks", { ...filters, basis, likelihood: cell?.l, impact: cell?.i }),
    placeholderData: keepPreviousData,
  })

  const rows = useMemo(() => {
    const r = [...(list.data ?? [])]
    const val = (x: Risk): number | string => sort.key === "code" ? x.code : sort.key === "inherent" ? (x.inherent_score ?? -1)
      : sort.key === "residual" ? (x.residual_score ?? -1) : (x.next_review_date ?? "9999")
    r.sort((a, b) => {
      const va = val(a), vb = val(b)
      const c = va < vb ? -1 : va > vb ? 1 : a.code.localeCompare(b.code)
      return sort.desc ? -c : c
    })
    return r
  }, [list.data, sort])

  const canCreate = canAny("risks.manage")
  const canExport = canAny("reports.export")
  const activeFilters = !!(scope || status || treatment || mine || overdue || aboveAppetite || q.trim() || cell)
  const clearAll = () => { setScope(null); setStatus(null); setTreatment(null); setMine(false); setOverdue(false); setAboveAppetite(false); setQ(""); setCell(null) }
  const exportXlsx = () => download(`/risks/export${qs(filters)}`, "NIS2_Risk_Register.xlsx").catch((e: Error) => toast.error(`Export failed: ${e.message}`))

  const h = heat.data
  const res = h?.by_level.residual
  return (
    <div>
      <PageHeader title="Risks"
        description="Risk register and treatment plan of the group and its entities (§ 30(2) no. 1 BSIG, Cbb Art. 7, IR 2024/2690 2.1). Each entity rates risks with its risk method."
        actions={
          <>
            <Button variant="outline" onClick={() => setMethodOpen(true)}><Settings2 /> Risk method</Button>
            {canExport && <Button variant="outline" onClick={exportXlsx}><Download /> Export register</Button>}
            {canCreate && <Button onClick={() => setNewOpen(true)}><Plus /> New risk</Button>}
          </>
        } />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-56">
          <OptionSelect value={scope} onChange={(v) => { setScope(v); setCell(null) }} allowNone noneLabel="All entities and group" placeholder="All entities and group"
            options={[{ value: "group", label: "Group-wide risks" }, ...(entities.data ?? []).map((e) => ({ value: String(e.id), label: <span><span className="font-mono text-[12px] text-ink-3">{e.code}</span> {e.name}</span> }))]} />
        </div>
        <div className="w-44">
          <OptionSelect value={status} onChange={setStatus} allowNone noneLabel="All statuses" placeholder="All statuses"
            options={(meta.data?.statuses ?? []).map((s) => ({ value: s, label: STATUS_LABEL[s as RiskStatus] }))} />
        </div>
        <div className="w-44">
          <OptionSelect value={treatment} onChange={setTreatment} allowNone noneLabel="Any treatment" placeholder="Any treatment"
            options={(meta.data?.treatments ?? []).map((t) => ({ value: t, label: TREATMENT_LABEL[t] }))} />
        </div>
        <Input className="w-56" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search risks" aria-label="Search risks" />
        <Toggle id="f-mine" label="My risks" checked={mine} onChange={setMine} />
        <Toggle id="f-overdue" label="Review overdue" checked={overdue} onChange={setOverdue} />
        <Toggle id="f-appetite" label="Above appetite" checked={aboveAppetite} onChange={setAboveAppetite} />
        {activeFilters && <Button size="sm" variant="ghost" onClick={clearAll}><X /> Clear filters</Button>}
      </div>

      {heat.error ? <ErrorState error={heat.error} className="mb-5" /> : null}
      <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <Section title="Heat map"
          actions={
            <div role="radiogroup" aria-label="Rating shown" className="inline-flex rounded-md border bg-surface p-0.5">
              {(["inherent", "residual"] as Basis[]).map((b) => (
                <button key={b} role="radio" aria-checked={basis === b} onClick={() => { setBasis(b); setCell(null) }}
                  className={cn("h-6 rounded-[4px] px-2.5 text-[12px] font-medium", basis === b ? "bg-petrol text-primary-foreground" : "text-ink-2 hover:bg-muted")}>
                  {b === "inherent" ? "Inherent" : "Residual"}
                </button>
              ))}
            </div>
          }>
          {!h ? <Loading className="p-0" /> : (
            <div className="space-y-3">
              <RiskHeatMap method={h.method} cells={h.cells[basis]} selected={cell} onSelect={setCell} />
              <LevelLegend method={h.method} />
              <p className="text-[12px] text-ink-3">
                {cell ? <>Showing risks in likelihood {cell.l}, impact {cell.i}. Click the cell again to show all.</> : "Click a cell to filter the register."}
                {h.unrated[basis] > 0 && <> {h.unrated[basis]} risk{h.unrated[basis] === 1 ? " has" : "s have"} no {basis} rating.</>}
                {!scope && " Colours follow the group method; entities with their own method may rate differently."}
              </p>
            </div>
          )}
        </Section>

        <Section title="Residual risk overview">
          {!h ? <Loading className="p-0" /> : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Risks" value={h.total} hint={`${h.unrated.residual} without residual rating`} />
                <Stat label="Very high or high" value={(res?.very_high ?? 0) + (res?.high ?? 0)} tone={(res?.very_high ?? 0) + (res?.high ?? 0) ? "alarm" : undefined}
                  hint={`${res?.very_high ?? 0} very high`} />
                <Stat label="Above appetite" value={h.entities.reduce((s, e) => s + e.above_appetite, 0)} tone="amber" hint="need a management body decision" />
                <Stat label="Medium or low" value={(res?.medium ?? 0) + (res?.low ?? 0)} tone="petrol" />
              </div>
              {h.entities.length > 0 && (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b text-left text-[12px] text-ink-3">
                      <th className="py-1.5 pr-2 font-medium">Scope</th>
                      {LEVELS.map((lv) => <th key={lv} className="px-1 py-1.5 text-right font-medium">{LEVEL_LABEL[lv]}</th>)}
                      <th className="py-1.5 pl-2 text-right font-medium">Above appetite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.entities.map((e) => (
                      <tr key={e.entity?.id ?? "group"} className="border-b last:border-0">
                        <td className="py-1.5 pr-2">
                          <button className="text-left hover:text-petrol" onClick={() => { setScope(e.entity ? String(e.entity.id) : "group"); setCell(null) }}>
                            {e.entity ? <><EntityTag code={e.entity.code} /> <span className="ml-1">{e.entity.name}</span></> : "Group-wide"}
                          </button>
                        </td>
                        {LEVELS.map((lv) => (
                          <td key={lv} className={cn("tabular px-1 py-1.5 text-right", e.residual[lv] ? "text-ink" : "text-ink-3")}>{e.residual[lv] || "–"}</td>
                        ))}
                        <td className={cn("tabular py-1.5 pl-2 text-right", e.above_appetite ? "font-medium text-alarm" : "text-ink-3")}>{e.above_appetite || "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </Section>
      </div>

      <Section title={<span>Risk register <span className="tabular font-normal text-ink-3">{rows.length}</span></span>} bodyClassName="p-0">
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} className="m-4" /> : rows.length === 0 ? (
          <Empty icon={<ShieldAlert className="size-6" />} title={activeFilters ? "No risks match these filters" : "No risks recorded yet"}
            action={activeFilters ? <Button variant="outline" onClick={clearAll}>Clear filters</Button> : canCreate ? <Button onClick={() => setNewOpen(true)}><Plus /> New risk</Button> : undefined}>
            {activeFilters ? "Change or clear the filters." : "Record risks with their scenario, rate them with the risk method and plan the treatment. Risks can also be created from gaps in the assessment."}
          </Empty>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[1100px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <SortTh label="Risk" k="code" sort={sort} setSort={setSort} className="pl-4" />
                  <th className="px-2 py-2 font-medium">Entity</th>
                  <th className="px-2 py-2 font-medium">Owner</th>
                  <SortTh label="Inherent" k="inherent" sort={sort} setSort={setSort} />
                  <SortTh label="Residual" k="residual" sort={sort} setSort={setSort} />
                  <th className="px-2 py-2 font-medium">Treatment</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <SortTh label="Next review" k="review" sort={sort} setSort={setSort} className="pr-4" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-b align-top last:border-0 hover:bg-muted/40" onClick={() => navigate(`/risks/${r.id}`)}>
                    <td className="py-2 pr-2 pl-4">
                      <div className="flex items-baseline gap-2">
                        <Code className="shrink-0">{r.code}</Code>
                        <Link to={`/risks/${r.id}`} className="font-medium text-ink hover:text-petrol" onClick={(e) => e.stopPropagation()}>{r.title}</Link>
                      </div>
                      {r.threat && <div className="mt-0.5 pl-[62px] text-[12px] text-ink-3">{r.threat.code} {r.threat.title}</div>}
                    </td>
                    <td className="px-2 py-2">{r.entity ? <EntityTag code={r.entity.code} name={r.entity.name} /> : <span className="text-[12.5px] text-ink-3">Group</span>}</td>
                    <td className="px-2 py-2 text-ink-2">{r.owner_user?.display_name ?? r.owner_stakeholder?.name ?? <span className="text-ink-3">–</span>}</td>
                    <td className="px-2 py-2"><LevelPill level={r.inherent_level} score={r.inherent_score} /></td>
                    <td className="px-2 py-2">
                      <div className="flex flex-col items-start gap-1">
                        <LevelPill level={r.residual_level} score={r.residual_score} />
                        {r.above_appetite && <span className="text-[11.5px] text-alarm">Above appetite</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.treatments.length ? r.treatments.map((t) => <Pill key={t} tone="outline">{TREATMENT_LABEL[t]}</Pill>) : <span className="text-ink-3">–</span>}
                      </div>
                      {r.transfer_only && <div className="mt-1 text-[11.5px] text-amber">Transfer only</div>}
                      {!!r.link_counts.treatment && <div className="mt-1 text-[11.5px] text-ink-3">{r.link_counts.treatment} measure{r.link_counts.treatment === 1 ? "" : "s"}</div>}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-col items-start gap-1">
                        <RiskStatusPill status={r.status} />
                        {r.acceptance_state !== "none" && r.acceptance_state !== "approved" && <ApprovalStatePill state={r.acceptance_state} />}
                      </div>
                    </td>
                    <td className={cn("tabular py-2 pr-4 pl-2 whitespace-nowrap", r.review_overdue ? "font-medium text-alarm" : "text-ink-2")}>
                      {fmtDate(r.next_review_date)}
                      {r.review_overdue && <div className="text-[11.5px] font-normal">Overdue</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <NewRiskDialog open={newOpen} onOpenChange={setNewOpen}
        draft={scope && scope !== "group" ? { entity_id: Number(scope) } : undefined}
        onCreated={(d) => navigate(`/risks/${d.risk.id}`)} />
      <MethodSheet open={methodOpen} onOpenChange={setMethodOpen} initialEntityId={scope && scope !== "group" ? Number(scope) : null} />
    </div>
  )
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="text-[12.5px] font-normal text-ink-2">{label}</Label>
    </div>
  )
}

function SortTh({ label, k, sort, setSort, className }: {
  label: string; k: SortKey; sort: { key: SortKey; desc: boolean }; setSort: (s: { key: SortKey; desc: boolean }) => void; className?: string
}) {
  const active = sort.key === k
  return (
    <th className={cn("px-2 py-2 font-medium", className)} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button className={cn("inline-flex items-center gap-1 hover:text-ink", active && "text-ink")}
        onClick={() => setSort({ key: k, desc: active ? !sort.desc : k !== "code" && k !== "review" })}>
        {label}
        {active && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  )
}
