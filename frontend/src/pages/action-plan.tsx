import { useMemo, useState, type ReactNode } from "react"
import { Link, useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download, Layers, ListPlus, Plus, Search, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, EntityTag, ErrorState, Loading, PageHeader, PriorityPill, ScoreChip, Section, Stat, StatusPill } from "@/components/common/basics"
import { Combo, Field, OptionSelect, StakeholderSelect } from "@/components/common/fields"
import { ActionItemSheet } from "@/components/assess/action-item-sheet"
import { NewWorkPackageDialog, type WorkPackagePreset } from "@/components/project/wp-shared"
import { readPref, useRequirements, writePref } from "@/components/assess/shared"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api, download } from "@/lib/api"
import { ACTION_STATUS, PRIORITY_VALUES } from "@/lib/constants"
import { fmtDate } from "@/lib/format"
import type { ActionItem, UnplannedFinding } from "@/lib/types"
import { cn } from "@/lib/utils"

const PRIO_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 }
const DUE_STATUS = ["Overdue", "Due soon", "On track", "Completed"] as const
const cmpNum = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

interface Col {
  key: string
  label: string
  optional?: boolean
  width?: string
  sort?: (i: ActionItem) => string | number
  render: (i: ActionItem) => ReactNode
  align?: "right"
}

const clamp = (v: string | null, lines = 2) => v ? <span className={lines === 2 ? "line-clamp-2" : "line-clamp-3"}>{v}</span> : <span className="text-ink-3">–</span>

const COLUMNS: Col[] = [
  { key: "code", label: "Code", width: "w-[76px]", sort: (i) => i.code, render: (i) => <Code className="text-ink">{i.code}</Code> },
  { key: "entity", label: "Entity", width: "w-[70px]", sort: (i) => i.entity.code, render: (i) => <EntityTag code={i.entity.code} name={i.entity.name} /> },
  { key: "requirement_no", label: "Req. no.", width: "w-[76px]", sort: (i) => i.requirement.number, render: (i) => <Code>{i.requirement.number}</Code> },
  { key: "chapter", label: "Chapter", optional: true, width: "min-w-[160px]", sort: (i) => Number(i.chapter.split(" ")[0]), render: (i) => <span className="line-clamp-2 text-ink-2">{i.chapter}</span> },
  { key: "requirement", label: "Requirement", optional: true, width: "min-w-[240px]", render: (i) => clamp(i.requirement_text) },
  { key: "identified_gap", label: "Identified gap", optional: true, width: "min-w-[220px]", render: (i) => clamp(i.identified_gap) },
  { key: "title", label: "Work package / title", width: "min-w-[280px]", sort: (i) => i.title.toLowerCase(), render: (i) => <span className="line-clamp-2 text-ink">{i.title}</span> },
  { key: "priority", label: "Priority", width: "w-[88px]", sort: (i) => PRIO_RANK[i.priority] ?? 9, render: (i) => <PriorityPill value={i.priority} /> },
  { key: "acceptance", label: "Acceptance criterion", optional: true, width: "min-w-[220px]", render: (i) => clamp(i.acceptance_criterion) },
  { key: "evidence", label: "Expected evidence", optional: true, width: "min-w-[200px]", render: (i) => clamp(i.expected_evidence) },
  { key: "responsible", label: "Responsible", width: "min-w-[140px]", sort: (i) => i.responsible?.name ?? "~", render: (i) => i.responsible?.name ?? <span className="text-ink-3">–</span> },
  { key: "target_date", label: "Target date", width: "w-[104px]", sort: (i) => i.target_date ?? "9999", render: (i) => <span className="tabular">{fmtDate(i.target_date)}</span> },
  { key: "status", label: "Status", width: "w-[110px]", sort: (i) => ACTION_STATUS.indexOf(i.status as (typeof ACTION_STATUS)[number]), render: (i) => <StatusPill value={i.status} /> },
  { key: "due_status", label: "Due status", width: "w-[100px]", sort: (i) => ["Overdue", "Due soon", "On track", "Completed"].indexOf(i.due_status ?? "") + 1 || 9, render: (i) => <StatusPill value={i.due_status} /> },
  { key: "comments", label: "Comments", optional: true, width: "min-w-[180px]", render: (i) => clamp(i.comments) },
  { key: "owner", label: "Assessment owner", optional: true, width: "min-w-[140px]", sort: (i) => i.assessment_owner ?? "~", render: (i) => i.assessment_owner ?? <span className="text-ink-3">–</span> },
  {
    key: "wps", label: "Work packages", width: "min-w-[100px]", sort: (i) => i.work_packages[0]?.code ?? "~",
    render: (i) => i.work_packages.length ? (
      <span className="flex flex-wrap gap-1.5">
        {i.work_packages.map((w) => (
          <Link key={w.id} to={`/work-packages/${w.id}`} onClick={(e) => e.stopPropagation()} title={w.title} className="hover:text-petrol"><Code>{w.code}</Code></Link>
        ))}
      </span>
    ) : <span className="text-ink-3">–</span>,
  },
]
const DEFAULT_HIDDEN = COLUMNS.filter((c) => c.optional).map((c) => c.key)

function NewItemDialog() {
  const { can } = useAuth()
  const entities = useEntities()
  const reqs = useRequirements()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const empty = { entity: null as number | null, requirement: null as number | null, title: "", priority: "Medium", responsible: null as number | null, target: "", acceptance: "" }
  const [f, setF] = useState(empty)
  const create = useMutation({
    mutationFn: () => api.post<ActionItem>("/action-items", {
      entity_id: f.entity, requirement_id: f.requirement, title: f.title.trim(), priority: f.priority, responsible_id: f.responsible,
      target_date: f.target || null, acceptance_criterion: f.acceptance.trim() || null,
    }),
    onSuccess: (it) => {
      toast.success(`${it.code} created`)
      qc.invalidateQueries({ queryKey: ["action-items"] })
      setOpen(false); setF(empty)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const allowed = (entities.data ?? []).filter((e) => can("findings.manage", e.id))
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> New item</Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New action plan item</DialogTitle>
          <DialogDescription>For measures that do not come from an assessment finding. Findings are added from the "Unplanned findings" tab.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entity">
            <OptionSelect value={f.entity != null ? String(f.entity) : null} onChange={(v) => setF({ ...f, entity: v ? Number(v) : null })} placeholder="Select entity"
              options={allowed.map((e) => ({ value: String(e.id), label: `${e.code} ${e.name}` }))} />
          </Field>
          <Field label="Priority"><OptionSelect value={f.priority} onChange={(v) => setF({ ...f, priority: v ?? "Medium" })} options={PRIORITY_VALUES} /></Field>
          <Field label="Requirement" className="col-span-2">
            <Combo value={f.requirement} onChange={(v) => setF({ ...f, requirement: v })} placeholder="Select requirement" searchPlaceholder="Number or text"
              items={(reqs.data ?? []).map((r) => ({ value: r.id, label: `${r.number} ${r.section.replace(/^[\d.]+\s*/, "")}` }))} />
          </Field>
          <Field label="Title" className="col-span-2" htmlFor="ni-title"><Textarea id="ni-title" rows={2} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Responsible"><StakeholderSelect value={f.responsible} onChange={(v) => setF({ ...f, responsible: v })} /></Field>
          <Field label="Target date" htmlFor="ni-target"><Input id="ni-target" type="date" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
          <Field label="Acceptance criterion" className="col-span-2" htmlFor="ni-acc"><Input id="ni-acc" value={f.acceptance} onChange={(e) => setF({ ...f, acceptance: e.target.value })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!f.entity || !f.requirement || !f.title.trim() || create.isPending} onClick={() => create.mutate()}>Create item</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Unplanned({ rows, entityFilter }: { rows: UnplannedFinding[]; entityFilter: number | null }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [priority, setPriority] = useState("Medium")
  const [q, setQ] = useState("")
  const visible = rows.filter((r) => (entityFilter == null || r.entity.id === entityFilter) && (!q.trim() || [r.finding_id, r.requirement.number, r.requirement.section, r.gap_description, r.recommended_action]
    .some((v) => (v ?? "").toLowerCase().includes(q.trim().toLowerCase()))))
  const selectable = visible.filter((r) => can("findings.manage", r.entity.id))
  const allSel = selectable.length > 0 && selectable.every((r) => sel.has(r.answer_id))
  const add = useMutation({
    mutationFn: () => api.post<ActionItem[]>("/action-items/from-findings", { answer_ids: [...sel], priority }),
    onSuccess: (items) => {
      toast.success(`${items.length} ${items.length === 1 ? "item" : "items"} added to the action plan`)
      qc.invalidateQueries({ queryKey: ["action-items"] })
      setSel(new Set())
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <Section bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <div className="relative w-72">
          <Search className="absolute top-2 left-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Finding, requirement or text" className="h-8 pl-8" aria-label="Search findings" />
        </div>
        <span className="text-[12.5px] text-ink-3"><span className="tabular font-medium text-ink">{visible.length}</span> findings without an action plan item</span>
        <div className="ml-auto flex items-center gap-2">
          {sel.size > 0 && <span className="text-[12.5px] text-ink-2">{sel.size} selected</span>}
          <div className="w-32"><OptionSelect size="sm" value={priority} onChange={(v) => setPriority(v ?? "Medium")} options={PRIORITY_VALUES.map((p) => ({ value: p, label: `${p} priority` }))} /></div>
          <Button size="sm" disabled={!sel.size || add.isPending} onClick={() => add.mutate()}><ListPlus /> Add {sel.size || ""} to action plan</Button>
        </div>
      </div>
      {visible.length === 0 ? (
        <Empty title={rows.length ? "No finding matches" : "Every finding is planned"}>
          {rows.length ? "Change the entity filter or search text." : "All answers that require a work package already have an action plan item."}
        </Empty>
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[1100px] text-[13px]">
            <thead>
              <tr className="border-b text-left text-[12px] text-ink-3">
                <th className="w-10 px-4 py-2">
                  <Checkbox aria-label="Select all findings" checked={allSel ? true : sel.size ? "indeterminate" : false}
                    onCheckedChange={() => setSel(allSel ? new Set() : new Set(selectable.map((r) => r.answer_id)))} />
                </th>
                <th className="w-[110px] px-2 py-2 font-medium">Finding</th>
                <th className="w-[70px] px-2 py-2 font-medium">Entity</th>
                <th className="min-w-[200px] px-2 py-2 font-medium">Requirement</th>
                <th className="w-[70px] px-2 py-2 text-right font-medium">Score</th>
                <th className="min-w-[220px] px-2 py-2 font-medium">Gap</th>
                <th className="min-w-[220px] px-2 py-2 font-medium">Recommended action</th>
                <th className="px-2 py-2 font-medium">Responsible</th>
                <th className="px-2 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Effort</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const ok = can("findings.manage", r.entity.id)
                return (
                  <tr key={r.answer_id} className={cn("border-b align-top last:border-0", sel.has(r.answer_id) ? "bg-petrol-50/60" : "hover:bg-muted/40")}>
                    <td className="px-4 py-2"><Checkbox disabled={!ok} checked={sel.has(r.answer_id)} onCheckedChange={() => toggle(r.answer_id)} aria-label={`Select ${r.finding_id ?? r.requirement.number}`} /></td>
                    <td className="px-2 py-2">
                      <Link to={`/assessments/${r.assessment_id}?req=${r.requirement.id}`} className="hover:text-petrol"><Code className="text-alarm">{r.finding_id}</Code></Link>
                    </td>
                    <td className="px-2 py-2"><EntityTag code={r.entity.code} name={r.entity.name} /></td>
                    <td className="px-2 py-2"><Code>{r.requirement.number}</Code> <span className="text-ink-2">{r.requirement.section.replace(/^[\d.]+\s*/, "")}</span></td>
                    <td className="px-2 py-2 text-right"><ScoreChip value={r.score} /></td>
                    <td className="px-2 py-2">{clamp(r.gap_description, 3)}</td>
                    <td className="px-2 py-2">{clamp(r.recommended_action, 3)}</td>
                    <td className="px-2 py-2 text-ink-2">{r.responsible ?? <span className="text-ink-3">–</span>}</td>
                    <td className="tabular px-2 py-2 text-ink-2">{fmtDate(r.target_date)}</td>
                    <td className="px-4 py-2 text-ink-2">{r.effort ?? <span className="text-ink-3">–</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

const PRIORITY_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 }

/** Work package defaults for the selected items: shared entity and responsible, highest priority, earliest target. */
function bundlePreset(items: ActionItem[]): WorkPackagePreset {
  const same = <T,>(vals: T[]) => (vals.every((v) => v === vals[0]) ? vals[0] : null)
  const dates = items.map((i) => i.target_date).filter((d): d is string => !!d).sort()
  return {
    title: same(items.map((i) => i.title)) ?? "",
    entity_id: same(items.map((i) => i.entity.id)),
    priority: [...items].sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9))[0]?.priority ?? "Medium",
    owner_stakeholder_id: same(items.map((i) => i.responsible?.id ?? null)),
    planned_finish: dates[0] ?? "",
    finding_ids: items.map((i) => i.id),
  }
}

export default function ActionPlanPage() {
  const { can, canAny } = useAuth()
  const entities = useEntities()
  const [params, setParams] = useSearchParams()
  const itemId = params.get("item") ? Number(params.get("item")) : null
  const tab = params.get("tab") === "unplanned" ? "unplanned" : "plan"
  const entity = params.get("entity") ? Number(params.get("entity")) : null
  const status = params.get("status")
  const priority = params.get("priority")
  const due = params.get("due")
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "code", dir: 1 })
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [bundle, setBundle] = useState<WorkPackagePreset | null>(null)
  const [hidden, setHidden] = useState<string[]>(() => readPref("nis2-ap-hidden-cols", DEFAULT_HIDDEN))

  const items = useQuery({ queryKey: ["action-items", "all"], queryFn: () => api.get<ActionItem[]>("/action-items") })
  const unplanned = useQuery({ queryKey: ["action-items", "unplanned"], queryFn: () => api.get<UnplannedFinding[]>("/action-items/unplanned"), enabled: canAny("findings.read") })

  const setParam = (k: string, v: string | null) => setParams((p) => { if (v == null || v === "") p.delete(k); else p.set(k, v); return p }, { replace: true })

  const all = useMemo(() => items.data ?? [], [items.data])
  const stats = useMemo(() => {
    const scoped = entity == null ? all : all.filter((i) => i.entity.id === entity)
    const by = (f: (i: ActionItem) => string | null) => scoped.reduce<Record<string, number>>((m, i) => { const k = f(i) ?? "–"; m[k] = (m[k] ?? 0) + 1; return m }, {})
    const byStatus = by((i) => i.status)
    return {
      total: scoped.length,
      byStatus,
      open: scoped.filter((i) => i.status !== "Completed").length,
      highOpen: scoped.filter((i) => i.priority === "High" && i.status !== "Completed").length,
      overdue: scoped.filter((i) => i.due_status === "Overdue").length,
      dueSoon: scoped.filter((i) => i.due_status === "Due soon").length,
      noTarget: scoped.filter((i) => !i.target_date && i.status !== "Completed").length,
      noWp: scoped.filter((i) => !i.work_packages.length).length,
    }
  }, [all, entity])

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase()
    const col = COLUMNS.find((c) => c.key === sort.key)
    const rows = all.filter((i) =>
      (entity == null || i.entity.id === entity) && (!status || i.status === status) && (!priority || i.priority === priority)
      && (!due || (due === "none" ? !i.due_status : i.due_status === due))
      && (!t || [i.code, i.title, i.requirement.number, i.requirement.section, i.identified_gap, i.finding_id, i.responsible?.name, i.comments, i.acceptance_criterion]
        .some((v) => (v ?? "").toLowerCase().includes(t))))
    if (col?.sort) {
      rows.sort((a, b) => {
        const va = col.sort!(a), vb = col.sort!(b)
        const r = typeof va === "number" && typeof vb === "number" ? va - vb : cmpNum(String(va), String(vb))
        return (r || cmpNum(a.code, b.code)) * sort.dir
      })
    }
    return rows
  }, [all, entity, status, priority, due, q, sort])

  const cols = COLUMNS.filter((c) => !hidden.includes(c.key))
  const canBundle = canAny("workpackages.manage")
  const pickedVisible = visible.filter((i) => picked.has(i.id))
  const allPicked = visible.length > 0 && pickedVisible.length === visible.length
  const togglePick = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleCol = (key: string) => {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key]
    setHidden(next); writePref("nis2-ap-hidden-cols", next)
  }
  const filtersActive = !!(status || priority || due || q)
  const unplannedCount = (unplanned.data ?? []).filter((r) => entity == null || r.entity.id === entity).length
  const statusBar = ACTION_STATUS.map((s) => ({ s, n: stats.byStatus[s] ?? 0 }))
  const STATUS_COLOR: Record<string, string> = { "Not Started": "var(--line-strong)", "In Progress": "var(--petrol)", Completed: "var(--sage)", Blocked: "var(--alarm)", Deferred: "var(--brass)" }

  return (
    <div>
      <PageHeader title="Action plan"
        description="Consolidated remediation measures for all findings of the GAP assessment, with owner, target date and link to the implementation work packages."
        actions={
          <>
            <div className="w-56"><OptionSelect value={entity != null ? String(entity) : null} onChange={(v) => setParam("entity", v)} allowNone noneLabel="All entities"
              options={(entities.data ?? []).map((e) => ({ value: String(e.id), label: `${e.code} ${e.name}` }))} /></div>
            {can("reports.export") && canAny("assessments.read") && (
              <Button variant="outline" onClick={() => download("/export/gap-workbook", "NIS2_GAP_Analysis.xlsx").catch((e) => toast.error(e.message))}><Download /> Export workbook</Button>
            )}
            {canAny("findings.manage") && <NewItemDialog />}
          </>
        } />

      <div data-tour="assess.action-plan" className="mb-5 rounded-md border bg-card px-5 py-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4 xl:grid-cols-7">
          <Stat label="Items" value={stats.total} hint={`${stats.open} open`} />
          <Stat label="Completed" value={stats.byStatus["Completed"] ?? 0} hint={stats.total ? `${Math.round(((stats.byStatus["Completed"] ?? 0) / stats.total) * 100)}% of all items` : undefined} tone="petrol" />
          <Stat label="Overdue" value={stats.overdue} tone={stats.overdue ? "alarm" : undefined} hint="Past the target date" />
          <Stat label="Due in 14 days" value={stats.dueSoon} tone={stats.dueSoon ? "amber" : undefined} />
          <Stat label="High priority open" value={stats.highOpen} />
          <Stat label="Without target date" value={stats.noTarget} tone={stats.noTarget ? "amber" : undefined} hint="Open items" />
          <Stat label="Unplanned findings" value={unplanned.data ? unplannedCount : "–"} tone={unplannedCount ? "amber" : undefined} hint="Not yet in this plan" />
        </div>
        {stats.total > 0 && (
          <div className="mt-4">
            <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              {statusBar.map(({ s, n }) => n ? <div key={s} style={{ width: `${(n / stats.total) * 100}%`, background: STATUS_COLOR[s] }} /> : null)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
              {statusBar.map(({ s, n }) => (
                <button key={s} type="button" onClick={() => setParams((p) => { p.delete("tab"); if (status === s) p.delete("status"); else p.set("status", s); return p }, { replace: true })}
                  className={cn("inline-flex items-center gap-1.5 rounded px-1 hover:text-ink", status === s && "bg-muted text-ink")}>
                  <span className="size-2 rounded-[2px]" style={{ background: STATUS_COLOR[s] }} />{s} <span className="tabular font-medium text-ink-2">{n}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setParam("tab", v === "unplanned" ? "unplanned" : null)}>
        <TabsList variant="line" className="mb-3">
          <TabsTrigger value="plan">Action plan <span className="tabular text-ink-3">{stats.total}</span></TabsTrigger>
          <TabsTrigger value="unplanned">Unplanned findings <span className="tabular text-ink-3">{unplanned.data ? unplannedCount : ""}</span></TabsTrigger>
        </TabsList>

        <TabsContent value="plan">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative w-72">
              <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Code, title, requirement, gap" className="pl-8" aria-label="Search action plan" />
              {q && <button className="absolute top-2.5 right-2.5 text-ink-3 hover:text-ink" onClick={() => setQ("")} aria-label="Clear search"><X className="size-4" /></button>}
            </div>
            <div className="w-40"><OptionSelect value={status} onChange={(v) => setParam("status", v)} allowNone noneLabel="Any status" placeholder="Status" options={ACTION_STATUS} /></div>
            <div className="w-36"><OptionSelect value={priority} onChange={(v) => setParam("priority", v)} allowNone noneLabel="Any priority" placeholder="Priority" options={PRIORITY_VALUES} /></div>
            <div className="w-40"><OptionSelect value={due} onChange={(v) => setParam("due", v)} allowNone noneLabel="Any due status" placeholder="Due status"
              options={[...DUE_STATUS.map((d) => ({ value: d, label: d })), { value: "none", label: "No target date" }]} /></div>
            {filtersActive && <Button variant="ghost" size="sm" onClick={() => { setQ(""); setParams((p) => { ["status", "priority", "due"].forEach((k) => p.delete(k)); return p }, { replace: true }) }}>Clear filters</Button>}
            {canBundle && pickedVisible.length > 0 && (
              <Button size="sm" onClick={() => setBundle(bundlePreset(pickedVisible))}><Layers /> Bundle {pickedVisible.length} into work package</Button>
            )}
            <span className="ml-auto text-[12.5px] text-ink-3"><span className="tabular font-medium text-ink">{visible.length}</span> of {stats.total}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Columns3 /> Columns</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {COLUMNS.map((c) => (
                  <DropdownMenuCheckboxItem key={c.key} checked={!hidden.includes(c.key)} disabled={c.key === "code" || c.key === "title"}
                    onCheckedChange={() => toggleCol(c.key)} onSelect={(e) => e.preventDefault()}>{c.label}</DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Section bodyClassName="p-0">
            {items.isLoading ? <Loading /> : items.error ? <ErrorState error={items.error} className="m-4" /> : all.length === 0 ? (
              <Empty title="The action plan is empty" action={canAny("findings.manage") ? <Button size="sm" variant="outline" onClick={() => setParam("tab", "unplanned")}>Show unplanned findings</Button> : undefined}>
                Add findings from the assessment to plan how each gap will be closed.
              </Empty>
            ) : visible.length === 0 ? (
              <Empty title="No item matches these filters">Change or clear the filters to see more items.</Empty>
            ) : (
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b text-left text-[12px] text-ink-3">
                      {canBundle && (
                        <th className="w-8 pl-4">
                          <Checkbox aria-label="Select all visible items" checked={allPicked ? true : pickedVisible.length ? "indeterminate" : false}
                            onCheckedChange={() => setPicked(allPicked ? new Set() : new Set(visible.map((i) => i.id)))} />
                        </th>
                      )}
                      {cols.map((c) => (
                        <th key={c.key} className={cn("px-3 py-2 font-medium whitespace-nowrap first:pl-4 last:pr-4", c.width)}
                          aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                          {c.sort ? (
                            <button type="button" className="inline-flex items-center gap-1 hover:text-ink"
                              onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
                              {c.label}
                              {sort.key === c.key ? (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-40" />}
                            </button>
                          ) : c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((i) => (
                      <tr key={i.id} tabIndex={0} onClick={() => setParam("item", String(i.id))}
                        onKeyDown={(e) => { if (e.key === "Enter") setParam("item", String(i.id)) }}
                        className={cn("cursor-pointer border-b align-top last:border-0 hover:bg-muted/40 focus-visible:bg-muted/60", itemId === i.id && "bg-petrol-50/60")}>
                        {canBundle && (
                          <td className="w-8 pl-4 pt-2.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                            <Checkbox checked={picked.has(i.id)} onCheckedChange={() => togglePick(i.id)} aria-label={`Select ${i.code}`} />
                          </td>
                        )}
                        {cols.map((c) => <td key={c.key} className={cn("px-3 py-2 first:pl-4 last:pr-4", c.width)}>{c.render(i)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="unplanned">
          {unplanned.isLoading ? <Loading /> : unplanned.error ? <ErrorState error={unplanned.error} /> : <Unplanned rows={unplanned.data ?? []} entityFilter={entity} />}
        </TabsContent>
      </Tabs>

      <ActionItemSheet itemId={itemId} onClose={() => setParam("item", null)} />
      {bundle && (
        <NewWorkPackageDialog open preset={bundle} onOpenChange={(v) => { if (!v) { setBundle(null); setPicked(new Set()) } }} />
      )}
    </div>
  )
}
