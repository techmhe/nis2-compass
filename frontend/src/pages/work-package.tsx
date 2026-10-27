import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Code, EntityTag, ErrorState, Loading, Meter, PriorityPill, Section, StatusPill } from "@/components/common/basics"
import { CommentsPanel, Confirm, DocumentLinks, UserAvatar } from "@/components/common/collab"
import { Combo, EntitySelect, Field, OptionSelect, StakeholderSelect, UserSelect } from "@/components/common/fields"
import { ScheduleDot, useActivities } from "@/components/project/shared"
import { FindingsPicker } from "@/components/project/wp-shared"
import { invalidateTaskViews, StatusDot, useTaskParam, useTaskPatch } from "@/components/tasks/common"
import { NewTaskDialog } from "@/components/tasks/new-task-dialog"
import { TaskDrawer } from "@/components/tasks/task-drawer"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { MEASURE_AREAS, PRIORITY_VALUES, PROJECT_STATUS, TASK_STATUSES } from "@/lib/constants"
import { fmtDate, fromNow, pct } from "@/lib/format"
import type { DocLink, Task, WorkPackage } from "@/lib/types"
import { cn } from "@/lib/utils"

interface WPDetail { work_package: WorkPackage; tasks: Task[]; documents: DocLink[]; can_edit: boolean }

type Form = ReturnType<typeof toForm>
function toForm(w: WorkPackage) {
  return {
    title: w.title, description: w.description ?? "", entity_id: w.entity?.id ?? null, measure_area: w.measure_area,
    central_or_local: w.central_or_local, priority: w.priority, owner_id: w.owner?.id ?? null,
    owner_stakeholder_id: w.owner_stakeholder?.id ?? null, planned_start: w.planned_start ?? "", planned_finish: w.planned_finish ?? "",
    acceptance_criterion: w.acceptance_criterion ?? "", expected_evidence: w.expected_evidence ?? "", dependency: w.dependency ?? "",
    status: w.status, progress: w.progress, progress_mode: w.progress_mode, budget_eur: w.budget_eur != null ? String(w.budget_eur) : "",
    comments: w.comments ?? "", activity_id: w.activity_id,
  }
}
function toBody(f: Form, projectId: number, findingIds?: number[]) {
  const budget = f.budget_eur.trim() ? Number(f.budget_eur.replace(",", ".")) : null
  return {
    project_id: projectId, title: f.title.trim(), description: f.description.trim() || null, entity_id: f.entity_id, measure_area: f.measure_area,
    central_or_local: f.central_or_local, priority: f.priority, owner_id: f.owner_id, owner_stakeholder_id: f.owner_stakeholder_id,
    planned_start: f.planned_start || null, planned_finish: f.planned_finish || null, acceptance_criterion: f.acceptance_criterion.trim() || null,
    expected_evidence: f.expected_evidence.trim() || null, dependency: f.dependency.trim() || null, status: f.status,
    progress: Math.min(1, Math.max(0, f.progress)), progress_mode: f.progress_mode, budget_eur: budget != null && Number.isFinite(budget) ? budget : null,
    comments: f.comments.trim() || null, activity_id: f.activity_id, ...(findingIds ? { finding_ids: findingIds } : {}),
  }
}

export default function WorkPackagePage() {
  const { id } = useParams()
  const wpId = Number(id)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ["work-package", wpId], queryFn: () => api.get<WPDetail>(`/work-packages/${wpId}`), enabled: Number.isFinite(wpId) })
  const [f, setF] = useState<Form | null>(null)
  const [seen, setSeen] = useState<WorkPackage | null>(null)
  const w = q.data?.work_package
  if (w && w !== seen) {
    // adopt server state unless the user has unsaved edits
    const dirtyNow = f && seen && JSON.stringify(f) !== JSON.stringify(toForm(seen))
    setSeen(w)
    if (!dirtyNow) setF(toForm(w))
  }
  const dirty = !!(f && seen && JSON.stringify(f) !== JSON.stringify(toForm(seen)))

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", h)
    return () => window.removeEventListener("beforeunload", h)
  }, [dirty])

  const invalidate = () => {
    for (const k of ["work-packages", "action-items", "gantt", "project-dashboard", "me-work", "dash-home"]) qc.invalidateQueries({ queryKey: [k] })
  }
  const save = useMutation({
    mutationFn: () => api.put<WorkPackage>(`/work-packages/${wpId}`, toBody(f!, w!.project_id)),
    onSuccess: (nw) => {
      toast.success(`Saved ${nw.code}`)
      setF(toForm(nw))
      qc.setQueryData<WPDetail>(["work-package", wpId], (old) => old && { ...old, work_package: nw })
      invalidate()
    },
    onError: (e: Error) => toast.error(`Could not save the work package: ${e.message}`),
  })
  const saveFindings = useMutation({
    mutationFn: (ids: number[]) => api.put<WorkPackage>(`/work-packages/${wpId}`, toBody(toForm(w!), w!.project_id, ids)),
    onSuccess: (nw) => {
      toast.success("Findings updated")
      qc.setQueryData<WPDetail>(["work-package", wpId], (old) => old && { ...old, work_package: nw })
      invalidate()
    },
    onError: (e: Error) => toast.error(`Could not update the findings: ${e.message}`),
  })
  const del = useMutation({
    mutationFn: () => api.del(`/work-packages/${wpId}`),
    onSuccess: () => { toast.success(`Deleted ${w?.code}`); invalidate(); navigate("/work-packages") },
    onError: (e: Error) => toast.error(e.message),
  })

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState error={q.error} />
  if (!q.data || !w || !f) return null
  const canEdit = q.data.can_edit
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => (p ? { ...p, [k]: v } : p))
  const dateError = f.planned_start && f.planned_finish && f.planned_finish < f.planned_start

  return (
    <div className="pb-16">
      <Link to="/work-packages" className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-petrol"><ChevronLeft className="size-3.5" /> Work packages</Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Code className="text-[13px]">{w.code}</Code>
            <StatusPill value={w.status} />
            <PriorityPill value={w.priority} />
            <ScheduleDot value={w.schedule_status} />
            {w.entity ? <EntityTag code={w.entity.code} name={w.entity.name} /> : <span className="text-[12.5px] text-ink-3">Group-wide</span>}
          </div>
          {canEdit ? (
            <Textarea value={f.title} rows={1} aria-label="Work package title" onChange={(e) => set("title", e.target.value.replace(/\n/g, " "))}
              className="min-h-0 resize-none border-transparent bg-transparent px-1.5 py-0.5 text-[22px] leading-tight font-semibold shadow-none field-sizing-content hover:border-border focus-visible:border-input" />
          ) : <h1 className="text-[22px] leading-tight font-semibold">{w.title}</h1>}
          <p className="mt-1 text-[12.5px] text-ink-3">Last updated {fromNow(w.updated_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Confirm title={`Delete ${w.code}?`} description="The work package is deleted. Its tasks stay but lose the link, and bundled findings return to the unbundled list."
              trigger={<Button variant="outline"><Trash2 /> Delete</Button>} onConfirm={() => del.mutate()} />
          )}
          {canEdit && (
            <Button disabled={!dirty || !f.title.trim() || !!dateError || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save changes"}</Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Section title="Scope and acceptance">
            <fieldset disabled={!canEdit} className="grid gap-3">
              <Field label="Description"><Textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What does this work package deliver?" /></Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Acceptance criterion"><Textarea rows={3} value={f.acceptance_criterion} onChange={(e) => set("acceptance_criterion", e.target.value)} /></Field>
                <Field label="Expected evidence"><Textarea rows={3} value={f.expected_evidence} onChange={(e) => set("expected_evidence", e.target.value)} /></Field>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Dependency"><Input value={f.dependency} onChange={(e) => set("dependency", e.target.value)} placeholder="e.g. WP-001 or supplier contract" /></Field>
                <Field label="Notes"><Input value={f.comments} onChange={(e) => set("comments", e.target.value)} /></Field>
              </div>
            </fieldset>
          </Section>

          <TasksSection wp={w} tasks={q.data.tasks} canAdd={canEdit} />

          <Section title={`Findings (${w.findings.length})`} actions={canEdit && <FindingsButton wp={w} onSave={(ids) => saveFindings.mutate(ids)} />} bodyClassName="p-0">
            {w.findings.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-ink-3">{canEdit ? "No findings bundled yet. Use Edit findings to add action-plan items from any entity." : "No findings bundled."}</p>
            ) : (
              <ul>
                {w.findings.map((fi) => (
                  <li key={fi.id} className="flex items-center gap-3 border-b px-4 py-2 last:border-0">
                    <Link to={`/action-plan?item=${fi.id}`} className="shrink-0 hover:text-petrol"><Code>{fi.code}</Code></Link>
                    <EntityTag code={fi.entity_code} />
                    <Code className="shrink-0 text-ink-3">{fi.requirement}</Code>
                    <Link to={`/action-plan?item=${fi.id}`} className="min-w-0 flex-1 truncate text-[13px] hover:text-petrol">{fi.title}</Link>
                    <StatusPill value={fi.status} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Documents and evidence">
            <DocumentLinks targetType="work_package" targetId={w.id} documents={q.data.documents} entityId={w.entity?.id ?? null} canEdit={canEdit}
              onChange={() => qc.invalidateQueries({ queryKey: ["work-package", wpId] })} />
          </Section>

          <Section title="Comments">
            <CommentsPanel targetType="work_package" targetId={w.id} />
          </Section>
        </div>

        <aside className="space-y-5">
          <Section title="Progress">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="tabular text-[22px] font-semibold">{pct(f.progress_mode === "manual" ? f.progress : w.progress)}</span>
              <span className="text-[12.5px] text-ink-3">{w.task_stats.done} of {w.task_stats.total} tasks done</span>
            </div>
            <Meter value={f.progress_mode === "manual" ? f.progress : w.progress} />
            <fieldset disabled={!canEdit} className="mt-3 space-y-3">
              <Field label="Progress is measured">
                <OptionSelect value={f.progress_mode} onChange={(v) => set("progress_mode", v ?? "tasks")} disabled={!canEdit}
                  options={[{ value: "tasks", label: "From completed tasks" }, { value: "manual", label: "Manually" }]} />
              </Field>
              {f.progress_mode === "manual" && (
                <Field label={`Manual progress (${pct(f.progress)})`}>
                  <input type="range" min={0} max={100} step={5} value={Math.round(f.progress * 100)} aria-label="Manual progress"
                    onChange={(e) => set("progress", Number(e.target.value) / 100)} className="h-8 w-full accent-[var(--petrol)]" />
                </Field>
              )}
            </fieldset>
          </Section>

          <Section title="Details">
            <fieldset disabled={!canEdit} className="grid grid-cols-2 gap-3">
              <Field label="Status"><OptionSelect value={f.status} onChange={(v) => set("status", v ?? "Not Started")} options={PROJECT_STATUS} disabled={!canEdit} /></Field>
              <Field label="Priority"><OptionSelect value={f.priority} onChange={(v) => set("priority", v ?? "Medium")} options={PRIORITY_VALUES} disabled={!canEdit} /></Field>
              <Field label="Entity" className="col-span-2"><EntitySelect value={f.entity_id} onChange={(v) => set("entity_id", v)} groupLabel="Group-wide" disabled={!canEdit} /></Field>
              <Field label="Central or local"><OptionSelect value={f.central_or_local} onChange={(v) => set("central_or_local", v ?? "Central")} options={["Central", "Local"]} disabled={!canEdit} /></Field>
              <Field label="Measure area"><OptionSelect value={f.measure_area} onChange={(v) => set("measure_area", v)} options={MEASURE_AREAS} allowNone noneLabel="Not set" disabled={!canEdit} /></Field>
              <Field label="Owner" className="col-span-2"><UserSelect value={f.owner_id} onChange={(v) => set("owner_id", v)} disabled={!canEdit} placeholder="Select owner…" /></Field>
              <Field label="Owner role" className="col-span-2"><StakeholderSelect value={f.owner_stakeholder_id} onChange={(v) => set("owner_stakeholder_id", v)} disabled={!canEdit} placeholder="Optional" /></Field>
              <Field label="Planned start"><Input type="date" value={f.planned_start} onChange={(e) => set("planned_start", e.target.value)} /></Field>
              <Field label="Planned finish" hint={dateError ? <span className="text-alarm">Before the start.</span> : undefined}>
                <Input type="date" value={f.planned_finish} onChange={(e) => set("planned_finish", e.target.value)} aria-invalid={!!dateError} />
              </Field>
              <Field label="Budget (EUR)"><Input inputMode="decimal" value={f.budget_eur} onChange={(e) => set("budget_eur", e.target.value)} placeholder="–" /></Field>
              <div />
              <Field label="Master plan activity" className="col-span-2"><ActivitySelect projectId={w.project_id} value={f.activity_id} onChange={(v) => set("activity_id", v)} disabled={!canEdit} /></Field>
            </fieldset>
            {w.activity_id && <Link to={`/projects/${w.project_id}/plan?activity=${w.activity_id}`} className="mt-2 inline-block text-[12.5px] text-petrol hover:underline">Open activity in the master plan</Link>}
          </Section>
        </aside>
      </div>

      {canEdit && dirty && (
        <div className="fixed right-6 bottom-6 z-40 flex items-center gap-3 rounded-md border bg-card px-4 py-2.5 shadow-lg">
          <span className="text-[13px] text-ink-2">You have unsaved changes.</span>
          <Button size="sm" variant="outline" onClick={() => setF(toForm(w))}>Discard changes</Button>
          <Button size="sm" disabled={!f.title.trim() || !!dateError || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save changes"}</Button>
        </div>
      )}

      <TaskDrawer />
    </div>
  )
}

function ActivitySelect({ projectId, value, onChange, disabled }: { projectId: number; value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  const { canAny } = useAuth()
  const acts = useActivities(projectId)
  if (!canAny("projects.read")) return <span className="text-[13px] text-ink-3">{value ? "Linked" : "None"}</span>
  return (
    <Combo value={value} onChange={onChange} disabled={disabled} placeholder="None"
      items={(acts.data ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.title}`, hint: fmtDate(a.planned_finish) }))} />
  )
}

function FindingsButton({ wp, onSave }: { wp: WorkPackage; onSave: (ids: number[]) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Edit findings</Button>
      <FindingsPicker open={open} onOpenChange={setOpen} value={wp.findings.map((f) => f.id)} currentWpId={wp.id}
        onConfirm={(ids) => {
          const cur = wp.findings.map((f) => f.id).sort().join(",")
          if ([...ids].sort().join(",") !== cur) onSave(ids)
        }} />
    </>
  )
}

function TasksSection({ wp, tasks, canAdd }: { wp: WorkPackage; tasks: Task[]; canAdd: boolean }) {
  const qc = useQueryClient()
  const [, openTask] = useTaskParam()
  const patch = useTaskPatch()
  const [title, setTitle] = useState("")
  const [dialog, setDialog] = useState(false)
  const [showDone, setShowDone] = useState(true)
  const add = useMutation({
    mutationFn: () => api.post<Task>("/tasks", { title: title.trim(), work_package_id: wp.id }),
    onSuccess: (t) => { toast.success(`Created ${t.key}`); setTitle(""); invalidateTaskViews(qc) },
    onError: (e: Error) => toast.error(`Could not create the task: ${e.message}`),
  })
  const byStatus = useMemo(() => TASK_STATUSES.map((s) => ({ ...s, n: tasks.filter((t) => t.status === s.key).length })), [tasks])
  const shown = showDone ? tasks : tasks.filter((t) => t.status !== "done")
  const total = tasks.length || 1

  return (
    <Section title={`Tasks (${tasks.length})`} bodyClassName="p-0"
      actions={
        <>
          {tasks.some((t) => t.status === "done") && (
            <Button size="sm" variant="ghost" onClick={() => setShowDone((v) => !v)}>{showDone ? "Hide done" : "Show done"}</Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setDialog(true)}><Plus /> New task</Button>
        </>
      }>
      {tasks.length > 0 && (
        <div className="border-b px-4 py-2.5">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
            {byStatus.map((s) => s.n > 0 && (
              <div key={s.key} className={cn({ todo: "bg-ink-3/50", in_progress: "bg-petrol", review: "bg-brass", blocked: "bg-alarm", done: "bg-sage" }[s.key])}
                style={{ width: `${(s.n / total) * 100}%` }} title={`${s.label}: ${s.n}`} />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 text-[12px] text-ink-3">
            {byStatus.filter((s) => s.n > 0).map((s) => <span key={s.key} className="inline-flex items-center gap-1"><StatusDot status={s.key} />{s.label} <span className="tabular text-ink-2">{s.n}</span></span>)}
          </div>
        </div>
      )}
      <ul>
        {tasks.length === 0 && <li className="px-4 py-4 text-[13px] text-ink-3">No tasks yet. Break the work package down into tasks so progress can be measured.</li>}
        {shown.map((t) => (
          <li key={t.id} className="group flex items-center gap-3 border-b px-4 py-2 last:border-0 hover:bg-muted/40">
            <Checkbox checked={t.status === "done"} aria-label={t.status === "done" ? `Reopen ${t.key}` : `Mark ${t.key} as done`}
              onCheckedChange={(v) => patch.mutate({ id: t.id, patch: { status: v === true ? "done" : "todo" } })} />
            <Code className="w-12 shrink-0">{t.key}</Code>
            <button onClick={() => openTask(t.id)} className={cn("min-w-0 flex-1 truncate text-left text-[13px] hover:text-petrol", t.status === "done" ? "text-ink-3 line-through" : "text-ink")}>{t.title}</button>
            <StatusPill value={t.status} />
            <span className={cn("tabular w-16 text-right text-[12px]", t.overdue ? "font-medium text-alarm" : "text-ink-3")}>{t.due_date ? fmtDate(t.due_date).replace(/ \d{4}$/, "") : ""}</span>
            <span className="w-6">{t.assignee && <span title={t.assignee.display_name}><UserAvatar name={t.assignee.display_name} className="size-6" /></span>}</span>
          </li>
        ))}
      </ul>
      {canAdd && (
        <form className="flex items-center gap-2 border-t px-4 py-2.5" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate() }}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task and press Enter" className="h-8" aria-label="New task title" />
          <Button size="sm" type="submit" disabled={!title.trim() || add.isPending}>Add task</Button>
        </form>
      )}
      <NewTaskDialog open={dialog} onOpenChange={setDialog} defaults={{ work_package_id: wp.id }} onCreated={(t) => openTask(t.id)} />
    </Section>
  )
}

