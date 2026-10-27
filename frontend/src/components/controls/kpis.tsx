import { useState } from "react"
import { useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts"
import { Gauge, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Code, EntityTag, Empty, ErrorState, KV, Loading, Pill, Section } from "@/components/common/basics"
import { Confirm } from "@/components/common/collab"
import { Field, OptionSelect, Segmented, UserSelect } from "@/components/common/fields"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { KpiImportDialog } from "./kpi-import"
import { fmtKpi, KpiStatusPill } from "./shared"
import type { KpiDefinition, KpiGrid, KpiInstance, KpiInstanceDetail, KpiOverview, KpiUnit } from "./types"

const VIEWS = ["Overview", "Data entry", "Catalogue"] as const
const FREQ_LABEL = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" }

export function KpisTab() {
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<string>("Overview")
  const instance = params.get("instance") ? Number(params.get("instance")) : null
  const openInstance = (id: number | null) => setParams((p) => { if (id) p.set("instance", String(id)); else p.delete("instance"); return p })
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={view} onChange={(v) => setView(v ?? view)} options={VIEWS} />
        <p className="min-w-0 flex-1 text-[12.5px] text-ink-3">Computed KPIs are refreshed daily from the assessments, action plan, controls, incidents and documents; the others are entered per period or imported.</p>
        <KpiImportDialog />
      </div>
      {view === "Overview" && <OverviewView onOpen={openInstance} />}
      {view === "Data entry" && <GridView onOpen={openInstance} />}
      {view === "Catalogue" && <CatalogueView />}
      <Sheet open={instance != null} onOpenChange={(v) => { if (!v) openInstance(null) }}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[680px]">
          {instance != null && <InstanceBody id={instance} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function Sparkline({ data, target, direction }: { data: { value: number }[]; target: number | null; direction: "higher" | "lower" }) {
  if (data.length < 2) return <span className="text-[12px] text-ink-3">–</span>
  const last = data[data.length - 1].value
  const ok = target == null ? null : direction === "higher" ? last >= target : last <= target
  return (
    <div className="h-7 w-24" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, bottom: 3, left: 2, right: 2 }}>
          <YAxis hide domain={["auto", "auto"]} />
          <Line type="monotone" dataKey="value" dot={false} strokeWidth={1.5} isAnimationActive={false}
            stroke={ok == null ? "var(--ink-3)" : ok ? "var(--petrol)" : "var(--alarm)"} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function OverviewView({ onOpen }: { onOpen: (id: number) => void }) {
  const [entity, setEntity] = useState<string | null>(null)
  const entities = useEntities()
  const ov = useQuery({ queryKey: ["controls", "kpis", "overview", entity], queryFn: () => api.get<KpiOverview>("/controls/kpis/overview", { entity }) })
  return (
    <div className="space-y-4">
      <div className="w-56">
        <OptionSelect value={entity} onChange={setEntity} allowNone noneLabel="Group and all entities" placeholder="Group and all entities"
          options={[{ value: "group", label: "Group-wide only" }, ...(entities.data ?? []).map((e) => ({ value: String(e.id), label: `${e.code} ${e.name}` }))]} />
      </div>
      {ov.isLoading ? <Loading /> : ov.error ? <ErrorState error={ov.error} /> : !ov.data?.items.length ? (
        <Empty title="No KPIs to show" icon={<Gauge className="size-6" />}>Define KPIs in the catalogue; they are measured group-wide and per entity.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {ov.data.items.map((d) => (
            <Section key={d.id} bodyClassName="p-0"
              title={<span className="flex items-baseline gap-2"><Code className="text-ink-3">{d.code}</Code>{d.name}</span>}
              actions={<span className="text-[12px] text-ink-3">{FREQ_LABEL[d.frequency]}, {d.direction === "higher" ? "higher is better" : "lower is better"}{d.computation ? ", computed" : ""}</span>}>
              <table className="w-full text-[13px]">
                <tbody>
                  {d.instance_rows.map((i) => (
                    <tr key={i.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/50" onClick={() => onOpen(i.id)}>
                      <td className="w-20 py-1.5 pl-4">{i.entity ? <EntityTag code={i.entity.code} name={i.entity.name} /> : <span className="text-[12.5px] font-medium text-ink">Group</span>}</td>
                      <td className="px-2 py-1.5">
                        <button type="button" className="tabular text-[15px] font-semibold text-ink hover:text-petrol" onClick={(e) => { e.stopPropagation(); onOpen(i.id) }}
                          aria-label={`${d.name} ${i.entity?.code ?? "group"}: open trend`}>
                          {fmtKpi(i.latest?.value, d.unit)}
                        </button>
                        {i.latest && <span className="ml-1.5 text-[12px] text-ink-3">{i.latest.label}</span>}
                      </td>
                      <td className="tabular px-2 py-1.5 text-[12px] text-ink-3">{i.effective_target != null ? `Target ${fmtKpi(i.effective_target, d.unit)}` : ""}</td>
                      <td className="px-2 py-1.5"><Sparkline data={i.trend} target={i.effective_target} direction={d.direction} /></td>
                      <td className="px-2 py-1.5 pr-4 text-right"><KpiStatusPill status={i.status} stale={i.stale && !d.computation} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ))}
        </div>
      )}
    </div>
  )
}

function GridView({ onOpen }: { onOpen: (id: number) => void }) {
  const entities = useEntities()
  const [scope, setScope] = useState<string>("group")
  const qc = useQueryClient()
  const g = useQuery({ queryKey: ["controls", "kpis", "grid", scope], queryFn: () => api.get<KpiGrid>("/controls/kpis/grid", { entity: scope, periods: 6 }) })
  const save = useMutation({
    mutationFn: ({ inst, period, value }: { inst: number; period: string; value: number | null }) =>
      value == null ? api.del(`/controls/kpis/instances/${inst}/values/${period}`) : api.put(`/controls/kpis/instances/${inst}/values/${period}`, { value }),
    onSuccess: (_, v) => { toast.success(v.value == null ? "Value removed" : "Value saved"); qc.invalidateQueries({ queryKey: ["controls", "kpis"] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <OptionSelect value={scope} onChange={(v) => setScope(v ?? "group")}
            options={[{ value: "group", label: "Group-wide" }, ...(entities.data ?? []).map((e) => ({ value: String(e.id), label: `${e.code} ${e.name}` }))]} />
        </div>
        <p className="text-[12.5px] text-ink-3">Type a value and press Enter or leave the field to save it. Clear a field to remove the value. Computed values are shown in grey.</p>
      </div>
      <div className="rounded-md border bg-card">
        {g.isLoading ? <Loading /> : g.error ? <ErrorState error={g.error} className="m-4" /> : !g.data?.rows.length ? (
          <Empty title="No KPIs measured for this scope">Add the KPI to this entity in the catalogue.</Empty>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[980px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">KPI</th>
                  <th className="px-2 py-2 font-medium">Target</th>
                  <th className="px-2 py-2 font-medium" colSpan={6}>Last periods (oldest first)</th>
                  <th className="px-2 py-2 pr-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {g.data.rows.map((r) => (
                  <tr key={r.instance.id} className="border-b align-top last:border-0">
                    <td className="py-2 pr-2 pl-4">
                      <button type="button" className="text-left hover:text-petrol" onClick={() => onOpen(r.instance.id)}>
                        <Code className="mr-1.5 text-ink-3">{r.definition.code}</Code>{r.definition.name}
                      </button>
                      <div className="text-[12px] text-ink-3">{FREQ_LABEL[r.definition.frequency]}, {r.definition.unit}{r.instance.owner_name ? `, owner ${r.instance.owner_name}` : ""}</div>
                    </td>
                    <td className="tabular px-2 py-2 text-ink-2">{fmtKpi(r.instance.effective_target, r.definition.unit)}</td>
                    {r.periods.map((p) => (
                      <td key={p.period} className="px-1 py-1.5">
                        <div className="mb-0.5 text-center text-[11px] text-ink-3">{p.label}</div>
                        <ValueCell key={`${p.period}-${p.value?.value ?? ""}-${p.value?.updated_at ?? ""}`} unit={r.definition.unit} value={p.value?.value ?? null}
                          computed={p.value?.source === "computed"} editable={r.instance.can_enter && !r.definition.computation}
                          label={`${r.definition.name} ${p.label}`}
                          onSave={(v) => save.mutate({ inst: r.instance.id, period: p.period, value: v })} />
                      </td>
                    ))}
                    <td className="px-2 py-2 pr-4"><KpiStatusPill status={r.instance.status} stale={r.instance.stale && !r.definition.computation} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function ValueCell({ value, unit, computed, editable, label, onSave }: {
  value: number | null; unit: KpiUnit; computed: boolean; editable: boolean; label: string; onSave: (v: number | null) => void
}) {
  const [text, setText] = useState(value == null ? "" : String(value))
  if (!editable) {
    return <div className={cn("tabular h-8 rounded-md px-2 text-center leading-8", computed ? "text-ink-3" : "text-ink-2")}>{fmtKpi(value, unit)}</div>
  }
  const commit = () => {
    const t = text.trim().replace(",", ".")
    if (t === (value == null ? "" : String(value))) return
    if (t === "") { if (value != null) onSave(null); return }
    const n = Number(t)
    if (!Number.isFinite(n)) { toast.error("Enter a number"); setText(value == null ? "" : String(value)); return }
    onSave(n)
  }
  return (
    <Input className="tabular h-8 w-[88px] px-2 text-center text-[13px]" inputMode="decimal" aria-label={label} value={text}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }} />
  )
}

function InstanceBody({ id }: { id: number }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ["controls", "kpis", "instance", id], queryFn: () => api.get<KpiInstanceDetail>(`/controls/kpis/instances/${id}`) })
  const [period, setPeriod] = useState<string | null>(null)
  const [value, setValue] = useState("")
  const [note, setNote] = useState("")
  const [editTarget, setEditTarget] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ["controls", "kpis"] })
  const put = useMutation({
    mutationFn: () => api.put(`/controls/kpis/instances/${id}/values/${period}`, { value: Number(value.replace(",", ".")), note: note.trim() || null }),
    onSuccess: () => { toast.success("Value saved"); setValue(""); setNote(""); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const del = useMutation({
    mutationFn: (p: string) => api.del(`/controls/kpis/instances/${id}/values/${p}`),
    onSuccess: () => { toast.success("Value removed"); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  if (q.isLoading) return <><SheetHeader><SheetTitle>KPI</SheetTitle><SheetDescription className="sr-only">Loading</SheetDescription></SheetHeader><Loading /></>
  if (q.error || !q.data) return <><SheetHeader><SheetTitle>KPI</SheetTitle><SheetDescription className="sr-only">Error</SheetDescription></SheetHeader><ErrorState className="m-4" error={q.error ?? "Not found"} /></>
  const { definition: d, instance: i, values, open_periods } = q.data
  const chart = [...values].reverse().map((v) => ({ label: v.label, value: v.value }))
  const selPeriod = period ?? open_periods[open_periods.length - 1]
  return (
    <>
      <SheetHeader className="border-b px-5 py-4">
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3"><Code>{d.code}</Code>{i.entity ? <EntityTag code={i.entity.code} name={i.entity.name} /> : <span>Group-wide</span>}</div>
        <SheetTitle className="text-[17px]">{d.name}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-2">
          <span className="tabular text-[15px] font-semibold text-ink">{fmtKpi(i.latest?.value, d.unit)}</span>
          {i.latest && <span>{i.latest.label}</span>}
          <KpiStatusPill status={i.status} stale={i.stale && !d.computation} />
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-5 py-4">
        <Section title="Trend">
          {chart.length === 0 ? <p className="text-[13px] text-ink-3">No values yet.</p> : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chart} margin={{ left: -8, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--ink-3)" }} stroke="var(--line)" />
                <YAxis tick={{ fontSize: 11, fill: "var(--ink-3)" }} stroke="var(--line)" domain={d.unit === "%" ? [0, 100] : ["auto", "auto"]} />
                <RTooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)" }}
                  formatter={(v) => [fmtKpi(Number(v), d.unit), d.name]} />
                {i.effective_target != null && (
                  <ReferenceLine y={i.effective_target} stroke="var(--brass)" strokeDasharray="4 3"
                    label={{ value: `Target ${fmtKpi(i.effective_target, d.unit)}`, position: "insideTopRight", fontSize: 11, fill: "var(--brass)" }} />
                )}
                <Line type="monotone" dataKey="value" stroke="var(--petrol)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Section>
        <div>
          {d.description && <p className="mb-2 text-[13px] text-ink-2">{d.description}</p>}
          <KV label="Target">
            <span className="flex items-center gap-2">
              {fmtKpi(i.effective_target, d.unit)}{i.target == null && d.default_target != null ? " (default)" : ""}
              {i.can_edit && <Button size="xs" variant="ghost" onClick={() => setEditTarget(true)}><Pencil /> Change target or owner</Button>}
            </span>
          </KV>
          <KV label="Owner">{i.owner_name}</KV>
          <KV label="Frequency">{FREQ_LABEL[d.frequency]}, {d.direction === "higher" ? "higher is better" : "lower is better"}</KV>
          <KV label="Source">{d.computation ? `Computed: ${d.computation_label}` : "Manual entry"}</KV>
          {d.legal_refs && <KV label="Legal basis"><Code>{d.legal_refs}</Code></KV>}
        </div>
        {i.can_enter && (
          <Section title={d.computation ? "Override a value" : "Enter a value"}>
            <form className="grid gap-2 sm:grid-cols-[150px_120px_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (value.trim()) put.mutate() }}>
              <Field label="Period">
                <OptionSelect value={selPeriod} onChange={(v) => setPeriod(v)} options={[...open_periods].reverse()} />
              </Field>
              <Field label={`Value (${d.unit})`} htmlFor="kpi-val">
                <Input id="kpi-val" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
              </Field>
              <Field label="Note" htmlFor="kpi-note"><Input id="kpi-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Source of the figure" /></Field>
              <Button type="submit" disabled={!value.trim() || put.isPending} onClick={() => setPeriod(selPeriod)}>Save value</Button>
            </form>
          </Section>
        )}
        <Section title="Values" bodyClassName="p-0">
          {values.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-3">No values recorded.</p> : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">Period</th><th className="px-2 py-2 text-right font-medium">Value</th>
                  <th className="px-2 py-2 font-medium">Source</th><th className="px-2 py-2 font-medium">Note</th><th className="px-2 py-2 pr-4"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {values.map((v) => (
                  <tr key={v.period} className="border-b last:border-0">
                    <td className="py-1.5 pr-2 pl-4">{v.label}</td>
                    <td className="tabular px-2 py-1.5 text-right font-medium">{fmtKpi(v.value, d.unit)}</td>
                    <td className="px-2 py-1.5"><Pill tone={v.source === "computed" ? "neutral" : "outline"}>{v.source === "computed" ? "Computed" : "Manual"}</Pill></td>
                    <td className="px-2 py-1.5 text-[12.5px] text-ink-2">{v.note ?? ""}{v.recorded_by ? <span className="text-ink-3"> {v.recorded_by}, {fmtDate(v.updated_at)}</span> : null}</td>
                    <td className="px-2 py-1.5 pr-4 text-right">
                      {i.can_enter && (
                        <Confirm title={`Remove the value for ${v.label}?`} description="The value is deleted." confirmLabel="Remove value"
                          onConfirm={() => del.mutate(v.period)} trigger={<Button size="icon-sm" variant="ghost" aria-label={`Remove value ${v.label}`}><Trash2 /></Button>} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
      {editTarget && <InstanceDialog instance={i} unit={d.unit} onClose={() => setEditTarget(false)} onSaved={() => { setEditTarget(false); refresh() }} />}
    </>
  )
}

function InstanceDialog({ instance, unit, onClose, onSaved }: { instance: KpiInstance; unit: KpiUnit; onClose: () => void; onSaved: () => void }) {
  const [target, setTarget] = useState(instance.target == null ? "" : String(instance.target))
  const [owner, setOwner] = useState<number | null>(instance.owner_user_id)
  const save = useMutation({
    mutationFn: () => api.put(`/controls/kpis/instances/${instance.id}`, { target: target.trim() === "" ? null : Number(target.replace(",", ".")), owner_user_id: owner }),
    onSuccess: () => { toast.success("KPI settings saved"); onSaved() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Target and owner</DialogTitle>
          <DialogDescription>For {instance.entity ? instance.entity.name : "the group"}. Leave the target empty to use the default of the KPI.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label={`Target (${unit})`} htmlFor="inst-target"><Input id="inst-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
          <Field label="Owner" hint="May enter values for this KPI"><UserSelect value={owner} onChange={setOwner} placeholder="Choose user…" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending || (target.trim() !== "" && !Number.isFinite(Number(target.replace(",", "."))))} onClick={() => save.mutate()}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface DefList { items: KpiDefinition[]; computations: Record<string, string>; can_manage: boolean }

function CatalogueView() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ["controls", "kpis", "definitions"], queryFn: () => api.get<DefList>("/controls/kpis/definitions") })
  const [editing, setEditing] = useState<KpiDefinition | "new" | null>(null)
  const recompute = useMutation({
    mutationFn: () => api.post<{ values: number }>("/controls/kpis/recompute", undefined, { backfill: 6 }),
    onSuccess: (r) => { toast.success(`${r.values} computed values updated`); qc.invalidateQueries({ queryKey: ["controls", "kpis"] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/controls/kpis/definitions/${id}`),
    onSuccess: () => { toast.success("KPI deleted"); qc.invalidateQueries({ queryKey: ["controls", "kpis"] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="space-y-3">
      {q.data?.can_manage && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={recompute.isPending} onClick={() => recompute.mutate()}><RefreshCw /> Recompute computed KPIs</Button>
          <Button onClick={() => setEditing("new")}><Plus /> Create KPI</Button>
        </div>
      )}
      <div className="rounded-md border bg-card">
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} className="m-4" /> : !q.data?.items.length ? <Empty title="No KPIs defined" /> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[920px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">KPI</th><th className="px-2 py-2 font-medium">Unit</th><th className="px-2 py-2 font-medium">Better</th>
                  <th className="px-2 py-2 font-medium">Default target</th><th className="px-2 py-2 font-medium">Frequency</th><th className="px-2 py-2 font-medium">Source</th>
                  <th className="px-2 py-2 font-medium">Legal basis</th><th className="px-2 py-2 pr-4"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((d) => (
                  <tr key={d.id} className={cn("border-b align-top last:border-0", !d.active && "text-ink-3")}>
                    <td className="py-2 pr-2 pl-4">
                      <div><Code className="mr-1.5">{d.code}</Code><span className="font-medium">{d.name}</span>{!d.active && <Pill tone="outline" className="ml-2">Inactive</Pill>}</div>
                      {d.description && <div className="mt-0.5 text-[12px] text-ink-3">{d.description}</div>}
                    </td>
                    <td className="px-2 py-2">{d.unit}</td>
                    <td className="px-2 py-2">{d.direction === "higher" ? "Higher" : "Lower"}</td>
                    <td className="tabular px-2 py-2">{fmtKpi(d.default_target, d.unit)}</td>
                    <td className="px-2 py-2">{FREQ_LABEL[d.frequency]}</td>
                    <td className="px-2 py-2">{d.computation ? <Pill tone="neutral" title={d.computation_label ?? undefined}>Computed</Pill> : "Manual"}</td>
                    <td className="px-2 py-2 text-[12px]">{d.legal_refs}</td>
                    <td className="px-2 py-2 pr-4 text-right whitespace-nowrap">
                      {q.data!.can_manage && (
                        <>
                          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${d.code}`} onClick={() => setEditing(d)}><Pencil /></Button>
                          <Confirm title={`Delete ${d.code}?`} description="Only possible while no values were entered manually; otherwise deactivate the KPI." confirmLabel="Delete KPI"
                            onConfirm={() => del.mutate(d.id)} trigger={<Button size="icon-sm" variant="ghost" aria-label={`Delete ${d.code}`}><Trash2 /></Button>} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && q.data && <DefinitionDialog def={editing === "new" ? null : editing} computations={q.data.computations} onClose={() => setEditing(null)} />}
    </div>
  )
}

function DefinitionDialog({ def, computations, onClose }: { def: KpiDefinition | null; computations: Record<string, string>; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({
    code: def?.code ?? "", name: def?.name ?? "", unit: def?.unit ?? "%", direction: def?.direction ?? "higher",
    description: def?.description ?? "", legal_refs: def?.legal_refs ?? "", default_target: def?.default_target == null ? "" : String(def.default_target),
    frequency: def?.frequency ?? "quarterly", computation: def?.computation ?? null as string | null, active: def?.active ?? true, sort_order: def?.sort_order ?? 100,
  })
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, description: f.description.trim() || null, legal_refs: f.legal_refs.trim() || null,
        default_target: f.default_target.trim() === "" ? null : Number(f.default_target.replace(",", ".")), create_instances: true }
      return def ? api.put(`/controls/kpis/definitions/${def.id}`, body) : api.post("/controls/kpis/definitions", body)
    },
    onMutate: () => setError(null),
    onSuccess: () => { toast.success(def ? "KPI saved" : "KPI created for the group and every entity"); qc.invalidateQueries({ queryKey: ["controls", "kpis"] }); onClose() },
    onError: (e: Error) => setError(e.message),
  })
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{def ? `Edit ${def.code}` : "Create KPI"}</DialogTitle>
          <DialogDescription>The KPI is measured group-wide and for every active entity.</DialogDescription>
        </DialogHeader>
        <form id="kpi-def" className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <Field label="Code" htmlFor="kd-code"><Input id="kd-code" className="font-mono" value={f.code} onChange={(e) => set("code", e.target.value)} maxLength={40} placeholder="e.g. MFA" /></Field>
          <Field label="Name" htmlFor="kd-name"><Input id="kd-name" value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={200} /></Field>
          <Field label="Unit"><OptionSelect value={f.unit} onChange={(v) => set("unit", (v ?? "%") as KpiUnit)} options={["%", "count", "days", "hours", "EUR"]} /></Field>
          <Field label="Better when"><OptionSelect value={f.direction} onChange={(v) => set("direction", (v ?? "higher") as "higher" | "lower")} options={[{ value: "higher", label: "Higher" }, { value: "lower", label: "Lower" }]} /></Field>
          <Field label="Default target" htmlFor="kd-target"><Input id="kd-target" inputMode="decimal" value={f.default_target} onChange={(e) => set("default_target", e.target.value)} /></Field>
          <Field label="Frequency"><OptionSelect value={f.frequency} onChange={(v) => set("frequency", (v ?? "quarterly") as typeof f.frequency)} options={Object.entries(FREQ_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Computation" className="sm:col-span-2">
            <OptionSelect value={f.computation} onChange={(v) => set("computation", v)} allowNone noneLabel="Manual entry"
              options={Object.entries(computations).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Description" className="sm:col-span-2" htmlFor="kd-desc"><Textarea id="kd-desc" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label="Legal basis" className="sm:col-span-2" htmlFor="kd-legal"><Input id="kd-legal" value={f.legal_refs} onChange={(e) => set("legal_refs", e.target.value)} placeholder="e.g. IR 11.7; § 30(2) Nr. 10 BSIG" /></Field>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch id="kd-active" checked={f.active} onCheckedChange={(v) => set("active", v)} />
            <Label htmlFor="kd-active" className="text-[13px] font-normal">Active</Label>
          </div>
          {error && <ErrorState className="sm:col-span-2" error={error} />}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="kpi-def" disabled={!f.code.trim() || !f.name.trim() || save.isPending}>{def ? "Save changes" : "Create KPI"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
