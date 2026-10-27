import { useState } from "react"
import { Link } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Diamond, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, ErrorState, KV, Loading, Meter, Section, Stat, StatusPill } from "@/components/common/basics"
import { Field, OptionSelect, UserSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { PROJECT_STATUS } from "@/lib/constants"
import { fmtDate, pct } from "@/lib/format"
import type { Project } from "@/lib/types"
import { cn } from "@/lib/utils"
import { daysLabel, nn, projectKeys, type ProjectDashboard } from "./shared"

export function ProjectOverview({ project }: { project: Project }) {
  const { canGlobal } = useAuth()
  const canManage = canGlobal("projects.manage")
  const [editing, setEditing] = useState(false)
  const dash = useQuery({
    queryKey: projectKeys.dashboard(project.id),
    queryFn: () => api.get<ProjectDashboard>(`/dashboard/project/${project.id}`),
  })
  const d = dash.data

  return (
    <div className="space-y-5">
      {dash.error ? <ErrorState error={dash.error} /> : !d ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border bg-card px-5 py-4 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Overall progress" value={pct(d.activities.overall_progress)} hint={`${d.activities.completed} of ${d.activities.total} activities completed`} tone="petrol" />
            <Stat label="In progress" value={d.activities.in_progress} hint={d.activities.blocked ? `${d.activities.blocked} blocked` : "none blocked"} tone={d.activities.blocked ? "alarm" : undefined} />
            <Stat label="Overdue activities" value={d.activities.red} hint={`${d.activities.finishing_next_30_days} finishing in the next 30 days`} tone={d.activities.red ? "alarm" : undefined} />
            <Stat label="Work packages" value={d.work_packages.total} hint={`${d.work_packages.high_priority_open} high priority open, ${d.work_packages.overdue} overdue`} tone={d.work_packages.overdue ? "alarm" : undefined} />
            <Stat label="Open risks and issues" value={d.raid.open_risks + d.raid.open_issues} hint={`${d.raid.high_severity_open} high severity`} tone={d.raid.high_severity_open ? "amber" : undefined} />
            <Stat label="Escalations" value={d.raid.escalations} hint={d.raid.overdue ? `${d.raid.overdue} RAID items overdue` : "no RAID item overdue"} tone={d.raid.escalations ? "alarm" : undefined} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Section title="Progress by phase" actions={<Link to={`/projects/${project.id}/plan`} className="text-[12.5px] text-petrol hover:underline">Open master plan</Link>}>
              {d.phases.length === 0 ? <Empty title="No activities yet" >Add activities in the master plan to track progress by phase.</Empty> : (
                <ul className="space-y-2.5">
                  {d.phases.map((ph) => (
                    <li key={ph.phase} className="grid grid-cols-[minmax(0,1fr)_minmax(120px,40%)_44px_64px] items-center gap-3 text-[13px]">
                      <span className="truncate text-ink">{ph.phase}</span>
                      <Meter value={ph.progress} tone={ph.overdue ? "alarm" : "petrol"} />
                      <span className="tabular text-right text-ink-2">{pct(ph.progress)}</span>
                      <span className="tabular text-right text-[12px] text-ink-3">{ph.completed}/{ph.activities} done</span>
                    </li>
                  ))}
                </ul>
              )}
              <ScheduleBreakdown a={d.activities} />
            </Section>

            <Section title="Gates" actions={<Link to={`/projects/${project.id}/gates`} className="text-[12.5px] text-petrol hover:underline">Manage gates</Link>} bodyClassName="p-0">
              {d.gates.length === 0 ? <Empty title="No gates defined">Gates are management decision points. Add them on the Gates tab.</Empty> : (
                <ul>
                  {d.gates.map((g) => (
                    <li key={g.id} className="grid grid-cols-[18px_64px_minmax(0,1fr)_auto] items-start gap-3 border-b px-4 py-2.5 last:border-0">
                      <Diamond className={cn("mt-0.5 size-3.5", g.status === "Completed" ? "fill-brass text-brass" : "text-brass")} aria-hidden />
                      <Code className="text-ink">{g.code}</Code>
                      <div className="min-w-0">
                        <div className="line-clamp-2 text-[13px] text-ink">{g.decision ?? "No decision described"}</div>
                        <div className="mt-0.5 text-[12px] text-ink-3">
                          {g.open_activities > 0 ? `${g.open_activities} of ${g.activities} gate activities open` : g.activities ? "All gate activities completed" : "No activities assigned"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="tabular text-[12.5px] text-ink-2">{fmtDate(g.planned_date)}</div>
                        {g.status === "Completed" ? <StatusPill value="Completed" /> : (
                          <div className={cn("tabular text-[12px]", g.overdue ? "font-medium text-alarm" : g.days_to_gate != null && g.days_to_gate <= 30 ? "text-amber" : "text-ink-3")}>
                            {daysLabel(g.days_to_gate)}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Work packages" actions={<Link to="/work-packages" className="text-[12.5px] text-petrol hover:underline">All work packages</Link>}>
              {d.work_packages.total === 0 ? <Empty title="No work packages yet">Bundle action-plan findings into work packages to plan remediation.</Empty> : (
                <StatusBars total={d.work_packages.total} data={d.work_packages.by_status}
                  order={["Not Started", "In Progress", "Blocked", "Completed", "Deferred", "Cancelled"]} />
              )}
            </Section>
            <Section title="RAID register" actions={<Link to={`/projects/${project.id}/raid`} className="text-[12.5px] text-petrol hover:underline">Open RAID</Link>}>
              <div className="grid grid-cols-3 gap-4">
                <Stat label="Open risks" value={d.raid.open_risks} />
                <Stat label="Open issues" value={d.raid.open_issues} tone={d.raid.open_issues ? "amber" : undefined} />
                <Stat label="Decisions logged" value={d.raid.decisions} />
                <Stat label="High severity open" value={d.raid.high_severity_open} tone={d.raid.high_severity_open ? "alarm" : undefined} />
                <Stat label="Escalation needed" value={d.raid.escalations} tone={d.raid.escalations ? "alarm" : undefined} />
                <Stat label="Overdue" value={d.raid.overdue} tone={d.raid.overdue ? "alarm" : undefined} />
              </div>
            </Section>
          </div>
        </>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Section title="Project" actions={canManage && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Edit project</Button>}>
          <KV label="Name">{project.name}</KV>
          <KV label="Code"><Code>{project.code}</Code></KV>
          <KV label="Status"><StatusPill value={project.status} /></KV>
          <KV label="Planned start">{fmtDate(project.planned_start)}</KV>
          <KV label="Planned finish">{fmtDate(project.planned_finish)}</KV>
          <KV label="Sponsor">{project.sponsor}</KV>
          <KV label="Project manager">{project.manager?.display_name}</KV>
          <KV label="Description">{project.description}</KV>
          <KV label="Version note">{project.version_note}</KV>
        </Section>
        <Section title="Project overview">
          {project.overview.length === 0 ? <Empty title="No overview entries">{canManage ? "Use Edit project to add fields such as scope, governance and reporting cadence." : "The project manager has not added overview fields yet."}</Empty> : (
            <dl className="divide-y">
              {project.overview.map((o, i) => (
                <div key={i} className="grid grid-cols-[minmax(130px,32%)_1fr] gap-3 py-2 text-[13px]">
                  <dt className="text-ink-3">{o.field}</dt>
                  <dd className="min-w-0 whitespace-pre-line break-words text-ink">{o.value || <span className="text-ink-3">–</span>}</dd>
                </div>
              ))}
            </dl>
          )}
        </Section>
      </div>

      {canManage && <EditProjectDialog project={project} open={editing} onOpenChange={setEditing} />}
    </div>
  )
}

function ScheduleBreakdown({ a }: { a: ProjectDashboard["activities"] }) {
  const parts = [
    { k: "Green", label: "On schedule", v: a.green, cls: "bg-sage" },
    { k: "Amber", label: "Finishing soon", v: a.amber, cls: "bg-amber" },
    { k: "Red", label: "Overdue", v: a.red, cls: "bg-alarm" },
    { k: "Not Planned", label: "Not planned", v: a.not_planned, cls: "bg-input" },
  ]
  const total = parts.reduce((s, p) => s + p.v, 0) || 1
  return (
    <div className="mt-5 border-t pt-4">
      <div className="mb-2 text-[12.5px] text-ink-3">Schedule status of all activities</div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {parts.map((p) => p.v > 0 && <div key={p.k} className={p.cls} style={{ width: `${(p.v / total) * 100}%` }} title={`${p.label}: ${p.v}`} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
        {parts.map((p) => (
          <span key={p.k} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", p.cls)} /> {p.label} <span className="tabular font-medium text-ink">{p.v}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function StatusBars({ total, data, order }: { total: number; data: Record<string, number>; order: string[] }) {
  return (
    <ul className="space-y-2">
      {order.filter((s) => (data[s] ?? 0) > 0 || ["Not Started", "In Progress", "Completed"].includes(s)).map((s) => (
        <li key={s} className="grid grid-cols-[110px_1fr_32px] items-center gap-3 text-[13px]">
          <StatusPill value={s} className="justify-self-start" />
          <Meter value={(data[s] ?? 0) / (total || 1)} tone={s === "Blocked" ? "alarm" : "petrol"} />
          <span className="tabular text-right text-ink-2">{data[s] ?? 0}</span>
        </li>
      ))}
    </ul>
  )
}

function EditProjectDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient()
  const init = () => ({
    name: project.name, code: project.code, status: project.status, planned_start: project.planned_start ?? "",
    planned_finish: project.planned_finish ?? "", sponsor: project.sponsor ?? "", manager_id: project.manager?.id ?? null,
    description: project.description ?? "", version_note: project.version_note ?? "",
    overview: project.overview.map((o) => ({ field: o.field, value: o.value ?? "" })),
  })
  const [f, setF] = useState(init)
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setF(init())
  }
  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) => setF((p) => ({ ...p, [k]: v }))
  const setRow = (i: number, patch: Partial<{ field: string; value: string }>) =>
    setF((p) => ({ ...p, overview: p.overview.map((o, j) => (j === i ? { ...o, ...patch } : o)) }))
  const move = (i: number, dir: -1 | 1) => setF((p) => {
    const o = [...p.overview]
    const j = i + dir
    if (j < 0 || j >= o.length) return p
    ;[o[i], o[j]] = [o[j], o[i]]
    return { ...p, overview: o }
  })

  const save = useMutation({
    mutationFn: () => api.put<Project>(`/projects/${project.id}`, {
      name: f.name.trim(), code: f.code.trim(), status: f.status, planned_start: nn(f.planned_start), planned_finish: nn(f.planned_finish),
      sponsor: nn(f.sponsor.trim()), manager_id: f.manager_id, description: nn(f.description.trim()), version_note: nn(f.version_note.trim()),
      overview: f.overview.filter((o) => o.field.trim()).map((o) => ({ field: o.field.trim(), value: o.value.trim() || null })),
    }),
    onSuccess: (p) => {
      qc.setQueryData(projectKeys.project(project.id), p)
      qc.invalidateQueries({ queryKey: ["projects"] })
      toast.success("Project saved")
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(`Could not save the project: ${e.message}`),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>Project master data and the overview fields from the project overview sheet.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Code"><Input value={f.code} onChange={(e) => set("code", e.target.value)} className="font-mono" /></Field>
          <Field label="Status"><OptionSelect value={f.status} onChange={(v) => set("status", v ?? "In Progress")} options={PROJECT_STATUS} /></Field>
          <Field label="Planned start"><Input type="date" value={f.planned_start} onChange={(e) => set("planned_start", e.target.value)} /></Field>
          <Field label="Planned finish"><Input type="date" value={f.planned_finish} onChange={(e) => set("planned_finish", e.target.value)} /></Field>
          <Field label="Sponsor"><Input value={f.sponsor} onChange={(e) => set("sponsor", e.target.value)} /></Field>
          <Field label="Project manager"><UserSelect value={f.manager_id} onChange={(v) => set("manager_id", v)} placeholder="Select a user…" /></Field>
          <Field label="Description" className="col-span-2"><Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label="Version note" className="col-span-2"><Input value={f.version_note} onChange={(e) => set("version_note", e.target.value)} /></Field>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13.5px] font-semibold">Overview fields</h3>
            <Button size="sm" variant="outline" onClick={() => set("overview", [...f.overview, { field: "", value: "" }])}><Plus /> Add field</Button>
          </div>
          {f.overview.length === 0 && <p className="text-[13px] text-ink-3">No overview fields. Add one to describe scope, governance or cadence.</p>}
          <ul className="space-y-2">
            {f.overview.map((o, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,200px)_minmax(0,1fr)_auto] items-start gap-2">
                <Input value={o.field} placeholder="Field" aria-label={`Field name ${i + 1}`} onChange={(e) => setRow(i, { field: e.target.value })} />
                <Textarea rows={1} value={o.value} placeholder="Value" aria-label={`Value for ${o.field || `field ${i + 1}`}`} className="min-h-9"
                  onChange={(e) => setRow(i, { value: e.target.value })} />
                <div className="flex">
                  <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === f.overview.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Remove field" onClick={() => set("overview", f.overview.filter((_, j) => j !== i))}><Trash2 /></Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!f.name.trim() || !f.code.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
