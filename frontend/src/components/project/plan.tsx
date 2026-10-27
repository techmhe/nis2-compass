import { Fragment, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronDown, ChevronRight, ChevronsUpDown, Diamond, Plus, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, ErrorState, Loading, PriorityPill, StatusPill } from "@/components/common/basics"
import { CommentsPanel, Confirm } from "@/components/common/collab"
import { Combo, Field, OptionSelect, StakeholderSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useStakeholders } from "@/hooks/useRefData"
import { api, ApiError } from "@/lib/api"
import { PRIORITY_VALUES, PROJECT_STATUS } from "@/lib/constants"
import { fmtDate, fmtDateShort, pct } from "@/lib/format"
import type { Activity } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ACTIVITY_DEPENDENT, nn, projectKeys, ScheduleDot, useActivities, useGates, usePhases } from "./shared"

const SCHEDULE_FILTER = [
  { value: "Red", label: "Overdue" }, { value: "Amber", label: "Finishing soon" },
  { value: "Green", label: "On schedule" }, { value: "Not Planned", label: "Not planned" },
]

export function useActivityPatch(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Pick<Activity, "status" | "progress" | "planned_start" | "planned_finish">> }) =>
      api.patch<Activity>(`/projects/activities/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      const key = projectKeys.activities(projectId)
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Activity[]>(key)
      qc.setQueryData<Activity[]>(key, (old) => old?.map((a) => (a.id === id
        ? { ...a, ...patch, progress: patch.status === "Completed" ? 1 : patch.progress ?? a.progress } : a)))
      return { prev }
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(projectKeys.activities(projectId), ctx.prev)
      toast.error(`Could not update the activity: ${e.message}`)
    },
    onSuccess: (a) => {
      qc.setQueryData<Activity[]>(projectKeys.activities(projectId), (old) => old?.map((x) => (x.id === a.id ? a : x)))
    },
    onSettled: () => ACTIVITY_DEPENDENT.filter((k) => k !== "activities").forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  })
}

export function MasterPlan({ projectId }: { projectId: number }) {
  const { canGlobal } = useAuth()
  const canManage = canGlobal("projects.manage")
  const acts = useActivities(projectId)
  const gates = useGates(projectId)
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [schedule, setSchedule] = useState<string | null>(null)
  const [owner, setOwner] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const gateFilter = params.get("gate") ? Number(params.get("gate")) : null
  const openId = params.get("activity") ? Number(params.get("activity")) : null
  const patch = useActivityPatch(projectId)

  const setOpen = (id: number | null) => {
    const p = new URLSearchParams(params)
    if (id == null) p.delete("activity")
    else p.set("activity", String(id))
    setParams(p, { replace: id == null })
  }

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (acts.data ?? []).filter((a) =>
      (!t || `${a.code} ${a.title} ${a.deliverable ?? ""} ${a.support ?? ""} ${a.owner?.name ?? ""}`.toLowerCase().includes(t))
      && (!status || a.status === status) && (!schedule || a.schedule_status === schedule)
      && (!owner || a.owner?.id === owner) && (!gateFilter || a.gate?.id === gateFilter))
  }, [acts.data, q, status, schedule, owner, gateFilter])

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; sort: number; items: Activity[] }>()
    for (const a of filtered) {
      const name = a.phase?.name ?? "Unassigned"
      const g = m.get(name) ?? { name, sort: a.phase?.sort_order ?? 999, items: [] }
      g.items.push(a)
      m.set(name, g)
    }
    return [...m.values()].sort((a, b) => a.sort - b.sort)
  }, [filtered])

  const current = acts.data?.find((a) => a.id === openId) ?? null
  const gateName = gates.data?.find((g) => g.id === gateFilter)?.code
  const filtersActive = !!(q || status || schedule || owner || gateFilter)

  if (acts.isLoading) return <Loading />
  if (acts.error) return <ErrorState error={acts.error} />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search activities" className="pl-8" aria-label="Search activities" />
        </div>
        <OptionSelect className="w-40" value={status} onChange={setStatus} options={PROJECT_STATUS} allowNone noneLabel="All statuses" placeholder="Status" />
        <OptionSelect className="w-40" value={schedule} onChange={setSchedule} options={SCHEDULE_FILTER} allowNone noneLabel="Any schedule" placeholder="Schedule" />
        <OwnerFilter value={owner} onChange={setOwner} />
        {gateFilter && (
          <Button size="sm" variant="outline" onClick={() => { const p = new URLSearchParams(params); p.delete("gate"); setParams(p) }}>
            Gate: {gateName ?? gateFilter} <X />
          </Button>
        )}
        {filtersActive && (
          <Button size="sm" variant="ghost" onClick={() => { setQ(""); setStatus(null); setSchedule(null); setOwner(null); const p = new URLSearchParams(params); p.delete("gate"); setParams(p) }}>
            Clear filters
          </Button>
        )}
        <span className="ml-auto text-[12.5px] text-ink-3 tabular">{filtered.length} of {acts.data?.length ?? 0} activities</span>
        {canManage && <Button onClick={() => setCreating(true)}><Plus /> New activity</Button>}
      </div>

      <div className="overflow-x-auto rounded-md border bg-card scroll-thin">
        <table className="w-full min-w-[1320px] border-separate border-spacing-0 text-[13px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="text-left text-[12px] text-ink-3 [&>th]:border-b [&>th]:px-2.5 [&>th]:py-2 [&>th]:font-medium">
              <th className="w-[64px]">ID</th>
              <th className="min-w-[240px]">Activity</th>
              <th className="w-[150px]">Owner</th>
              <th className="w-[130px]">Support</th>
              <th className="w-[78px]">Start</th>
              <th className="w-[78px]">Finish</th>
              <th className="w-[44px] text-right">Wks</th>
              <th className="w-[92px]">Depends on</th>
              <th className="min-w-[200px]">Deliverable / exit criterion</th>
              <th className="w-[92px]">Gate</th>
              <th className="w-[138px]">Status</th>
              <th className="w-[80px]">Priority</th>
              <th className="w-[92px]">Progress</th>
              <th className="w-[112px]">Schedule</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr><td colSpan={14}>
                <Empty title={filtersActive ? "No activities match the filters" : "The master plan is empty"}>
                  {filtersActive ? "Clear or change the filters to see more activities." : canManage ? "Create the first activity to start planning." : "The project manager has not planned any activities yet."}
                </Empty>
              </td></tr>
            )}
            {groups.map((g) => {
              const isCollapsed = collapsed.has(g.name)
              const done = g.items.filter((a) => a.status === "Completed").length
              const avg = g.items.reduce((s, a) => s + a.progress, 0) / (g.items.length || 1)
              return (
                <Fragment key={g.name}>
                  <tr className="bg-muted/60">
                    <td colSpan={14} className="border-b px-2.5 py-1.5">
                      <button className="flex w-full items-center gap-2 text-left" aria-expanded={!isCollapsed}
                        onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(g.name)) n.delete(g.name); else n.add(g.name); return n })}>
                        {isCollapsed ? <ChevronRight className="size-4 text-ink-3" /> : <ChevronDown className="size-4 text-ink-3" />}
                        <span className="text-[13px] font-semibold text-ink">{g.name}</span>
                        <span className="text-[12px] text-ink-3 tabular">{done}/{g.items.length} completed, {pct(avg)} progress</span>
                      </button>
                    </td>
                  </tr>
                  {!isCollapsed && g.items.map((a) => (
                    <tr key={a.id} className={cn("group align-top hover:bg-muted/40 [&>td]:border-b [&>td]:px-2.5 [&>td]:py-2", openId === a.id && "bg-petrol-50/60")}>
                      <td><button className="text-left hover:text-petrol" onClick={() => setOpen(a.id)}><Code>{a.code}</Code></button></td>
                      <td>
                        <button className="flex items-start gap-1.5 text-left text-ink hover:text-petrol" onClick={() => setOpen(a.id)}>
                          {a.is_milestone && <Diamond className="mt-1 size-3 shrink-0 text-ink-2" aria-label="Milestone" />}
                          <span>{a.title}</span>
                        </button>
                        {a.task_count > 0 && <div className="mt-0.5 text-[12px] text-ink-3">{a.task_count} linked task{a.task_count === 1 ? "" : "s"}</div>}
                      </td>
                      <td className="text-ink-2">{a.owner?.name ?? <span className="text-ink-3">–</span>}</td>
                      <td className="text-[12.5px] text-ink-3">{a.support ?? "–"}</td>
                      <td className="tabular whitespace-nowrap text-ink-2">{fmtDateShort(a.planned_start)}</td>
                      <td className="tabular whitespace-nowrap text-ink-2">{fmtDateShort(a.planned_finish)}</td>
                      <td className="tabular text-right text-ink-2">{a.duration_weeks ?? "–"}</td>
                      <td>
                        {a.dependencies.length === 0 ? <span className="text-ink-3">–</span> : (
                          <div className="flex flex-wrap gap-1">{a.dependencies.map((d) => <Code key={d.id} className="text-[11.5px]">{d.code}</Code>)}</div>
                        )}
                      </td>
                      <td className="text-[12.5px] text-ink-2"><span className="line-clamp-2">{a.deliverable ?? "–"}</span></td>
                      <td>
                        {a.gate ? (
                          <div className="leading-tight">
                            <span className="inline-flex items-center gap-1 text-[12.5px] text-brass"><Diamond className="size-3" />{a.gate.code}</span>
                            <div className="tabular text-[11.5px] text-ink-3">{fmtDateShort(a.gate.planned_date)}</div>
                          </div>
                        ) : <span className="text-ink-3">–</span>}
                      </td>
                      <td>
                        {canManage ? (
                          <OptionSelect size="sm" className="h-7 w-[128px] text-[12.5px]" value={a.status} options={PROJECT_STATUS}
                            onChange={(v) => v && v !== a.status && patch.mutate({ id: a.id, patch: { status: v } })} />
                        ) : <StatusPill value={a.status} />}
                      </td>
                      <td><PriorityPill value={a.priority} /></td>
                      <td>
                        <ProgressCell value={a.progress} disabled={!canManage}
                          onChange={(v) => patch.mutate({ id: a.id, patch: { progress: v } })} />
                      </td>
                      <td><ScheduleDot value={a.schedule_status} /></td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <ActivityDialog projectId={projectId} activity={current} open={!!current || creating}
        onOpenChange={(v) => { if (!v) { setCreating(false); setOpen(null) } }} canManage={canManage} />
    </div>
  )
}

function OwnerFilter({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const { data = [] } = useStakeholders()
  return (
    <div className="w-52">
      <Combo value={value} onChange={onChange} placeholder="Any owner" items={data.map((s) => ({ value: s.id, label: s.name }))} />
    </div>
  )
}

const PROGRESS_STEPS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]

export function ProgressCell({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState("")
  const bar = (
    <span className="flex w-full items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-petrol" style={{ width: `${value * 100}%` }} />
      </span>
      <span className="tabular w-9 text-right text-[12px] text-ink-2">{pct(value)}</span>
    </span>
  )
  if (disabled) return bar
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) setCustom(String(Math.round(value * 100))) }}>
      <PopoverTrigger asChild>
        <button className="flex h-7 w-full items-center rounded px-1 hover:bg-muted" aria-label={`Progress ${pct(value)}, change`}>{bar}</button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-3" align="start">
        <div className="mb-2 text-[12.5px] font-medium text-ink-2">Set progress</div>
        <div className="grid grid-cols-4 gap-1">
          {PROGRESS_STEPS.map((s) => (
            <Button key={s} size="xs" variant={Math.abs(s - value) < 0.001 ? "default" : "outline"} onClick={() => { onChange(s); setOpen(false) }}>{pct(s)}</Button>
          ))}
        </div>
        <form className="mt-2 flex items-center gap-2" onSubmit={(e) => {
          e.preventDefault()
          const n = Number(custom)
          if (Number.isFinite(n) && n >= 0 && n <= 100) { onChange(n / 100); setOpen(false) } else toast.error("Enter a number between 0 and 100")
        }}>
          <Input type="number" min={0} max={100} value={custom} onChange={(e) => setCustom(e.target.value)} className="h-8" aria-label="Progress in percent" />
          <span className="text-[12.5px] text-ink-3">%</span>
          <Button size="sm" type="submit">Set</Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

interface ActivityForm {
  code: string; phase_id: number | null; title: string; owner_id: number | null; support: string
  planned_start: string; planned_finish: string; actual_finish: string; dependency_ids: number[]; deliverable: string
  gate_id: number | null; status: string; priority: string; progress: number; is_milestone: boolean
}

function toForm(a: Activity | null, defaultPhase: number | null): ActivityForm {
  return {
    code: a?.code ?? "", phase_id: a?.phase?.id ?? defaultPhase, title: a?.title ?? "", owner_id: a?.owner?.id ?? null,
    support: a?.support ?? "", planned_start: a?.planned_start ?? "", planned_finish: a?.planned_finish ?? "",
    actual_finish: a?.actual_finish ?? "", dependency_ids: a?.dependencies.map((d) => d.id) ?? [], deliverable: a?.deliverable ?? "",
    gate_id: a?.gate?.id ?? null, status: a?.status ?? "Not Started", priority: a?.priority ?? "Medium", progress: a?.progress ?? 0,
    is_milestone: a?.is_milestone ?? false,
  }
}

function ActivityDialog({ projectId, activity, open, onOpenChange, canManage }: {
  projectId: number; activity: Activity | null; open: boolean; onOpenChange: (v: boolean) => void; canManage: boolean
}) {
  const qc = useQueryClient()
  const phases = usePhases(projectId)
  const gates = useGates(projectId)
  const acts = useActivities(projectId)
  const [f, setF] = useState<ActivityForm>(() => toForm(activity, null))
  const [error, setError] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string>("")
  const key = open ? `${activity?.id ?? "new"}` : ""
  if (key !== openKey) {
    setOpenKey(key)
    if (open) { setF(toForm(activity, phases.data?.[0]?.id ?? null)); setError(null) }
  }
  const set = <K extends keyof ActivityForm>(k: K, v: ActivityForm[K]) => setF((p) => ({ ...p, [k]: v }))
  const readOnly = !canManage
  const invalidate = () => ACTIVITY_DEPENDENT.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: nn(f.code.trim()), phase_id: f.phase_id, title: f.title.trim(), owner_id: f.owner_id, support: nn(f.support.trim()),
        planned_start: nn(f.planned_start), planned_finish: nn(f.planned_finish), actual_finish: nn(f.actual_finish),
        dependency_ids: f.dependency_ids, deliverable: nn(f.deliverable.trim()), gate_id: f.gate_id, status: f.status,
        priority: f.priority, progress: f.progress, is_milestone: f.is_milestone,
      }
      return activity ? api.put<Activity>(`/projects/activities/${activity.id}`, body) : api.post<Activity>(`/projects/${projectId}/activities`, body)
    },
    onSuccess: (a) => {
      toast.success(activity ? `Saved ${a.code}` : `Created ${a.code}`)
      invalidate()
      onOpenChange(false)
    },
    onError: (e: Error) => {
      const msg = e instanceof ApiError ? e.message : String(e)
      setError(msg)
      toast.error(msg)
    },
  })
  const del = useMutation({
    mutationFn: () => api.del(`/projects/activities/${activity!.id}`),
    onSuccess: () => { toast.success(`Deleted ${activity!.code}`); invalidate(); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })

  const dateError = f.planned_start && f.planned_finish && f.planned_finish < f.planned_start ? "Planned finish is before planned start." : null
  const candidates = (acts.data ?? []).filter((a) => a.id !== activity?.id)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {activity ? <><Code className="text-[14px]">{activity.code}</Code> <span className="truncate">{activity.title}</span></> : "New activity"}
          </DialogTitle>
          <DialogDescription>
            {activity ? <>Schedule status: <ScheduleDot value={activity.schedule_status} /></> : "Add an activity to the master plan. The ID is generated from the phase if left empty."}
          </DialogDescription>
        </DialogHeader>
        {error && <ErrorState error={error} />}
        <fieldset disabled={readOnly} className="grid grid-cols-6 gap-3">
          <Field label="ID" className="col-span-1"><Input value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="auto" className="font-mono" /></Field>
          <Field label="Activity" className="col-span-5"><Input value={f.title} onChange={(e) => set("title", e.target.value)} autoFocus={!activity} /></Field>
          <Field label="Phase" className="col-span-3">
            <OptionSelect value={f.phase_id != null ? String(f.phase_id) : null} onChange={(v) => set("phase_id", v ? Number(v) : null)} disabled={readOnly}
              allowNone noneLabel="No phase" options={(phases.data ?? []).map((p) => ({ value: String(p.id), label: p.name }))} />
          </Field>
          <Field label="Owner" className="col-span-3"><StakeholderSelect value={f.owner_id} onChange={(v) => set("owner_id", v)} disabled={readOnly} placeholder="Select owner…" /></Field>
          <Field label="Support" className="col-span-6"><Input value={f.support} onChange={(e) => set("support", e.target.value)} placeholder="e.g. IT Coordinator; DPO" /></Field>
          <Field label="Planned start" className="col-span-2"><Input type="date" value={f.planned_start} onChange={(e) => set("planned_start", e.target.value)} /></Field>
          <Field label="Planned finish" className="col-span-2" hint={dateError ? <span className="text-alarm">{dateError}</span> : undefined}>
            <Input type="date" value={f.planned_finish} onChange={(e) => set("planned_finish", e.target.value)} aria-invalid={!!dateError} />
          </Field>
          <Field label="Actual finish" className="col-span-2"><Input type="date" value={f.actual_finish} onChange={(e) => set("actual_finish", e.target.value)} /></Field>
          <Field label="Depends on" className="col-span-6" hint="Predecessors that must finish first. Circular dependencies are rejected.">
            <DependencySelect value={f.dependency_ids} onChange={(v) => set("dependency_ids", v)} options={candidates} disabled={readOnly} />
          </Field>
          <Field label="Deliverable / exit criterion" className="col-span-6"><Textarea rows={2} value={f.deliverable} onChange={(e) => set("deliverable", e.target.value)} /></Field>
          <Field label="Gate" className="col-span-2">
            <OptionSelect value={f.gate_id != null ? String(f.gate_id) : null} onChange={(v) => set("gate_id", v ? Number(v) : null)} disabled={readOnly}
              allowNone noneLabel="No gate" options={(gates.data ?? []).map((g) => ({ value: String(g.id), label: `${g.code}${g.planned_date ? ` (${fmtDate(g.planned_date)})` : ""}` }))} />
          </Field>
          <Field label="Status" className="col-span-2"><OptionSelect value={f.status} onChange={(v) => set("status", v ?? "Not Started")} options={PROJECT_STATUS} disabled={readOnly} /></Field>
          <Field label="Priority" className="col-span-2"><OptionSelect value={f.priority} onChange={(v) => set("priority", v ?? "Medium")} options={PRIORITY_VALUES} disabled={readOnly} /></Field>
          <Field label={`Progress (${pct(f.status === "Completed" ? 1 : f.progress)})`} className="col-span-4">
            <input type="range" min={0} max={100} step={5} value={Math.round((f.status === "Completed" ? 1 : f.progress) * 100)}
              onChange={(e) => set("progress", Number(e.target.value) / 100)} className="h-9 w-full accent-[var(--petrol)]" aria-label="Progress" />
          </Field>
          <label className="col-span-2 flex items-center gap-2 self-end pb-2 text-[13px] text-ink-2">
            <Checkbox checked={f.is_milestone} onCheckedChange={(v) => set("is_milestone", v === true)} disabled={readOnly} /> Milestone
          </label>
        </fieldset>
        {activity && (
          <div className="border-t pt-3">
            <h3 className="mb-2 text-[13.5px] font-semibold">Comments</h3>
            <CommentsPanel targetType="activity" targetId={activity.id} canComment={canManage} />
          </div>
        )}
        <DialogFooter className="items-center">
          {activity && canManage && (
            <Confirm title={`Delete ${activity.code}?`} description="The activity is removed from the master plan. Linked tasks stay but lose the link."
              trigger={<Button variant="ghost" className="mr-auto text-alarm hover:text-alarm"><Trash2 /> Delete activity</Button>}
              onConfirm={() => del.mutate()} />
          )}
          {activity && activity.task_count > 0 && <Link to="/tasks" className="text-[12.5px] text-petrol hover:underline">{activity.task_count} linked tasks</Link>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{canManage ? "Cancel" : "Close"}</Button>
          {canManage && (
            <Button disabled={!f.title.trim() || !!dateError || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : activity ? "Save changes" : "Create activity"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DependencySelect({ value, onChange, options, disabled }: {
  value: number[]; onChange: (v: number[]) => void; options: Activity[]; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const byId = new Map(options.map((a) => [a.id, a]))
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" disabled={disabled} className="h-auto min-h-9 w-full justify-between px-3 py-1.5 font-normal">
            <span className="flex flex-wrap gap-1">
              {value.length === 0 ? <span className="text-ink-3">No dependencies</span> : value.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded border bg-surface px-1.5 text-[12px]">
                  <Code className="text-[11.5px]">{byId.get(id)?.code ?? id}</Code>
                  {!disabled && (
                    <span role="button" tabIndex={-1} aria-label={`Remove ${byId.get(id)?.code ?? id}`} className="text-ink-3 hover:text-alarm"
                      onClick={(e) => { e.stopPropagation(); toggle(id) }}><X className="size-3" /></span>
                  )}
                </span>
              ))}
            </span>
            <ChevronsUpDown className="size-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[420px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search by ID or title" />
            <CommandList className="max-h-72">
              <CommandEmpty>No activity matches.</CommandEmpty>
              <CommandGroup>
                {options.map((a) => (
                  <CommandItem key={a.id} value={`${a.code} ${a.title}`} onSelect={() => toggle(a.id)}>
                    <Check className={cn("size-3.5", value.includes(a.id) ? "opacity-100" : "opacity-0")} />
                    <Code className="w-12 shrink-0">{a.code}</Code>
                    <span className="truncate">{a.title}</span>
                    <span className="ml-auto shrink-0 text-[11.5px] text-ink-3 tabular">{fmtDateShort(a.planned_finish)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
