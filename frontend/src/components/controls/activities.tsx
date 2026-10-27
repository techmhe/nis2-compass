import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarCheck, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Code, EntityTag, Empty, ErrorState, KV, Loading, Pill, Section } from "@/components/common/basics"
import { CommentsPanel, Confirm } from "@/components/common/collab"
import { Field, OptionSelect, StakeholderSelect, UserSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useOccurrenceParam } from "./calendar"
import { OccurrenceSheet } from "./occurrence-sheet"
import { RequirementPicker } from "./requirement-picker"
import { MONTHS, OccurrencePill, RECURRENCE_LABEL, scheduleText } from "./shared"
import type { ControlActivity, Occurrence, Recurrence } from "./types"

interface ActivityList { items: ControlActivity[]; can_manage: boolean }
interface ActivityDetail { activity: ControlActivity; occurrences: Occurrence[]; can_manage: boolean }

export function ActivitiesTab() {
  const [params, setParams] = useSearchParams()
  const selected = params.get("activity") ? Number(params.get("activity")) : null
  const [q, setQ] = useState("")
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<ControlActivity | "new" | null>(null)
  const list = useQuery({ queryKey: ["controls", "activities"], queryFn: () => api.get<ActivityList>("/controls/activities") })
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (list.data?.items ?? []).filter((a) => (showInactive || a.active) && (!needle
      || `${a.code} ${a.title} ${a.legal_refs ?? ""} ${a.requirements.map((r) => r.number).join(" ")}`.toLowerCase().includes(needle)))
  }, [list.data, q, showInactive])
  const canManage = !!list.data?.can_manage
  const open = (id: number | null) => setParams((p) => { if (id) p.set("activity", String(id)); else p.delete("activity"); return p })

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[320px] min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, title, requirement" className="pl-8" aria-label="Search activities" />
        </div>
        <div className="flex h-9 items-center gap-2 rounded-md border bg-card px-3">
          <Switch id="act-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
          <Label htmlFor="act-inactive" className="text-[13px] font-normal text-ink-2">Show inactive</Label>
        </div>
        <div className="flex-1" />
        {canManage && <Button onClick={() => setEditing("new")}><Plus /> Create activity</Button>}
      </div>

      <div className="rounded-md border bg-card">
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} className="m-4" /> : (list.data?.items.length ?? 0) === 0 ? (
          <Empty title="No control activities" icon={<CalendarCheck className="size-6" />}
            action={canManage && <Button size="sm" onClick={() => setEditing("new")}><Plus /> Create activity</Button>}>
            Define recurring controls such as access reviews or restore tests. Occurrences are generated per entity for the next 12 months.
          </Empty>
        ) : rows.length === 0 ? <Empty title="No activity matches">Change the search or show inactive activities.</Empty> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[1000px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">Activity</th>
                  <th className="px-2 py-2 font-medium">Schedule</th>
                  <th className="px-2 py-2 font-medium">Requirements</th>
                  <th className="px-2 py-2 font-medium">Entities</th>
                  <th className="px-2 py-2 font-medium">Owner</th>
                  <th className="px-2 py-2 font-medium">Next due</th>
                  <th className="px-2 py-2 pr-4 font-medium">Last 12 months</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className={cn("cursor-pointer border-b align-top last:border-0 hover:bg-muted/50", selected === a.id && "bg-petrol-50/40")}
                    onClick={() => open(a.id)}>
                    <td className="py-2 pr-2 pl-4">
                      <div className="flex items-baseline gap-2">
                        <Code className="shrink-0">{a.code}</Code>
                        <div>
                          <button type="button" className="text-left font-medium text-ink hover:text-petrol" onClick={(e) => { e.stopPropagation(); open(a.id) }}>{a.title}</button>
                          {!a.active && <Pill tone="outline" className="ml-2">Inactive</Pill>}
                          {a.legal_refs && <div className="mt-0.5 text-[12px] text-ink-3">{a.legal_refs}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-ink-2">{RECURRENCE_LABEL[a.recurrence]}</td>
                    <td className="px-2 py-2"><span className="flex flex-wrap gap-x-2">{a.requirements.map((r) => <Code key={r.id}>{r.number}</Code>)}</span></td>
                    <td className="px-2 py-2">
                      {a.entity_scope === "all" ? <span className="text-ink-2">All</span> : (
                        <span className="flex flex-wrap gap-1">{a.entities.map((e) => <EntityTag key={e.id} code={e.code} name={e.name} />)}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-ink-2">{a.owner_user_name ?? a.owner_stakeholder_name ?? <span className="text-ink-3">–</span>}</td>
                    <td className="tabular px-2 py-2 whitespace-nowrap text-ink-2">{fmtDate(a.stats.next_due)}</td>
                    <td className="px-2 py-2 pr-4"><StatsLine a={a} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ActivitySheet id={selected} onClose={() => open(null)} onEdit={(a) => setEditing(a)} />
      {editing && <ActivityDialog activity={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(a) => { setEditing(null); open(a.id) }} />}
    </div>
  )
}

function StatsLine({ a }: { a: ControlActivity }) {
  const s = a.stats
  return (
    <span className="flex flex-wrap items-center gap-1 text-[12px] text-ink-3">
      <span className="tabular">{s.done ?? 0} done</span>
      {!!s.partially_effective && <Pill tone="amber">{s.partially_effective} partial</Pill>}
      {!!s.not_effective && <Pill tone="alarm">{s.not_effective} not effective</Pill>}
      {!!s.overdue && <Pill tone="alarm">{s.overdue} overdue</Pill>}
    </span>
  )
}

function ActivitySheet({ id, onClose, onEdit }: { id: number | null; onClose: () => void; onEdit: (a: ControlActivity) => void }) {
  return (
    <Sheet open={id != null} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[760px]">
        {id != null && <ActivityBody id={id} onEdit={onEdit} onDeleted={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function ActivityBody({ id, onEdit, onDeleted }: { id: number; onEdit: (a: ControlActivity) => void; onDeleted: () => void }) {
  const qc = useQueryClient()
  const occ = useOccurrenceParam()
  const q = useQuery({ queryKey: ["controls", "activity", id], queryFn: () => api.get<ActivityDetail>(`/controls/activities/${id}`) })
  const del = useMutation({
    mutationFn: () => api.del(`/controls/activities/${id}`),
    onSuccess: () => { toast.success("Activity deleted"); qc.invalidateQueries({ queryKey: ["controls"] }); onDeleted() },
    onError: (e: Error) => toast.error(e.message),
  })
  const [past, setPast] = useState(false)
  if (q.isLoading) return <><SheetHeader><SheetTitle>Control activity</SheetTitle><SheetDescription className="sr-only">Loading</SheetDescription></SheetHeader><Loading /></>
  if (q.error || !q.data) return <><SheetHeader><SheetTitle>Control activity</SheetTitle><SheetDescription className="sr-only">Error</SheetDescription></SheetHeader><ErrorState className="m-4" error={q.error ?? "Not found"} /></>
  const { activity: a, occurrences, can_manage } = q.data
  const today = new Date().toISOString().slice(0, 10)
  const shown = occurrences.filter((o) => (past ? o.due_date < today : o.due_date >= today || o.status === "overdue"))
  const recorded = occurrences.some((o) => o.stored_status !== "planned")
  return (
    <>
      <SheetHeader className="border-b px-5 py-4">
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3"><Code>{a.code}</Code>{!a.active && <Pill tone="outline">Inactive</Pill>}</div>
        <SheetTitle className="text-[17px] leading-snug">{a.title}</SheetTitle>
        <SheetDescription>{scheduleText(a.recurrence, a.anchor_month, a.rrule)}</SheetDescription>
        {can_manage && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => onEdit(a)}><Pencil /> Edit activity</Button>
            {recorded ? (
              <span className="self-center text-[12px] text-ink-3">Has recorded results: deactivate it instead of deleting.</span>
            ) : (
              <Confirm title={`Delete ${a.code}?`} description="The activity and its planned occurrences are removed." confirmLabel="Delete activity"
                onConfirm={() => del.mutate()} trigger={<Button size="sm" variant="outline" className="text-alarm"><Trash2 /> Delete</Button>} />
            )}
          </div>
        )}
      </SheetHeader>
      <div className="space-y-5 px-5 py-4">
        <div>
          {a.description && <p className="mb-2 text-[13px] text-ink-2">{a.description}</p>}
          <KV label="Required evidence">{a.required_evidence}</KV>
          <KV label="Evidence valid for">{a.evidence_validity_days} days</KV>
          <KV label="Owner">{[a.owner_user_name, a.owner_stakeholder_name].filter(Boolean).join(", ") || null}</KV>
          <KV label="Entities">{a.entity_scope === "all" ? "All active entities" : <span className="flex flex-wrap gap-1">{a.entities.map((e) => <EntityTag key={e.id} code={e.code} name={e.name} />)}</span>}</KV>
          <KV label="Requirements">
            {a.requirements.length ? (
              <span className="flex flex-col gap-0.5">
                {a.requirements.map((r) => (
                  <Link key={r.id} to={`/catalog/${r.id}`} className="flex gap-2 hover:text-petrol"><Code>{r.number}</Code><span className="text-[12.5px]">{r.section.replace(/^[\d.]+\s*/, "")}</span></Link>
                ))}
              </span>
            ) : null}
          </KV>
          {a.legal_refs && <KV label="Legal basis"><Code>{a.legal_refs}</Code></KV>}
        </div>

        <Section title="Occurrences" bodyClassName="p-0"
          actions={
            <div role="radiogroup" className="inline-flex rounded-md border bg-surface p-0.5 text-[12px]">
              {[["Upcoming", false], ["Past", true]].map(([l, v]) => (
                <button key={String(l)} type="button" role="radio" aria-checked={past === v} onClick={() => setPast(v as boolean)}
                  className={cn("rounded-[4px] px-2 py-0.5 font-medium", past === v ? "bg-petrol text-white" : "text-ink-2 hover:bg-muted")}>{l as string}</button>
              ))}
            </div>
          }>
          {shown.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-3">{past ? "No past occurrences in the last 24 months." : "No upcoming occurrence. Activate the activity to plan occurrences."}</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">Period</th>
                  <th className="px-2 py-2 font-medium">Entity</th>
                  <th className="px-2 py-2 font-medium">Due</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 pr-4 font-medium">Performed</th>
                </tr>
              </thead>
              <tbody>
                {(past ? [...shown].reverse() : shown).map((o) => (
                  <tr key={o.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/50" onClick={() => occ.open(o.id)}>
                    <td className="py-1.5 pr-2 pl-4">
                      <button type="button" className="hover:text-petrol" onClick={(e) => { e.stopPropagation(); occ.open(o.id) }}>{o.period_label}</button>
                    </td>
                    <td className="px-2 py-1.5"><EntityTag code={o.entity.code} name={o.entity.name} /></td>
                    <td className="tabular px-2 py-1.5 text-ink-2">{fmtDate(o.due_date)}</td>
                    <td className="px-2 py-1.5"><OccurrencePill status={o.status} result={o.result} /></td>
                    <td className="px-2 py-1.5 pr-4 text-[12.5px] text-ink-2">{o.performed_at ? `${fmtDate(o.performed_at)}${o.performed_by_name ? `, ${o.performed_by_name}` : ""}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
        <Section title="Comments">
          <CommentsPanel targetType="control_activity" targetId={a.id} canComment={can_manage} />
        </Section>
      </div>
      <OccurrenceSheet id={occ.id} onClose={occ.close} />
    </>
  )
}

interface FormState {
  title: string
  description: string
  requirement_ids: number[]
  legal_refs: string
  entity_scope: "all" | "list"
  entity_ids: number[]
  recurrence: Recurrence
  rrule: string
  anchor_month: number
  owner_stakeholder_id: number | null
  owner_user_id: number | null
  required_evidence: string
  evidence_validity_days: number
  active: boolean
}

const ANCHOR_MAX: Record<Recurrence, number> = { monthly: 1, quarterly: 3, semi_annual: 6, annual: 12, custom: 12 }

function ActivityDialog({ activity, onClose, onSaved }: { activity: ControlActivity | null; onClose: () => void; onSaved: (a: ControlActivity) => void }) {
  const qc = useQueryClient()
  const entities = useEntities()
  const { canAny } = useAuth()
  const [f, setF] = useState<FormState>(() => activity ? {
    title: activity.title, description: activity.description ?? "", requirement_ids: activity.requirement_ids,
    legal_refs: activity.legal_refs ?? "", entity_scope: activity.entity_scope, entity_ids: activity.entity_ids,
    recurrence: activity.recurrence, rrule: activity.rrule ?? "", anchor_month: activity.anchor_month,
    owner_stakeholder_id: activity.owner_stakeholder_id, owner_user_id: activity.owner_user_id,
    required_evidence: activity.required_evidence ?? "", evidence_validity_days: activity.evidence_validity_days, active: activity.active,
  } : {
    title: "", description: "", requirement_ids: [], legal_refs: "", entity_scope: "all", entity_ids: [], recurrence: "quarterly",
    rrule: "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=-1", anchor_month: 3, owner_stakeholder_id: null, owner_user_id: null,
    required_evidence: "", evidence_validity_days: 120, active: true,
  })
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }))
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, description: f.description.trim() || null, legal_refs: f.legal_refs.trim() || null,
        required_evidence: f.required_evidence.trim() || null, rrule: f.recurrence === "custom" ? f.rrule.trim() : null,
        anchor_month: Math.min(f.anchor_month, ANCHOR_MAX[f.recurrence]) }
      return activity ? api.put<ControlActivity>(`/controls/activities/${activity.id}`, body) : api.post<ControlActivity>("/controls/activities", body)
    },
    onMutate: () => setError(null),
    onSuccess: (a) => {
      toast.success(activity ? "Activity saved; occurrences updated" : `${a.code} created with occurrences for the next 12 months`)
      qc.invalidateQueries({ queryKey: ["controls"] })
      onSaved(a)
    },
    onError: (e: Error) => setError(e.message),
  })
  const anchorOptions = f.recurrence === "annual"
    ? MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))
    : Array.from({ length: ANCHOR_MAX[f.recurrence] }, (_, i) => ({ value: String(i + 1), label: `Month ${i + 1} of the period` }))
  const invalid = !f.title.trim() || (f.entity_scope === "list" && f.entity_ids.length === 0) || (f.recurrence === "custom" && !f.rrule.trim())

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{activity ? `Edit ${activity.code}` : "Create control activity"}</DialogTitle>
          <DialogDescription>
            Saving plans the occurrences per entity for the next 12 months. Planned occurrences that no longer fit the schedule are removed; recorded results are kept.
          </DialogDescription>
        </DialogHeader>
        <form id="activity-form" className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate() }}>
          <Field label="Title" className="sm:col-span-2" htmlFor="act-title">
            <Input id="act-title" autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={300} required placeholder="e.g. Quarterly review of user access rights" />
          </Field>
          <Field label="Description" className="sm:col-span-2" htmlFor="act-desc">
            <Textarea id="act-desc" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What is checked and how" />
          </Field>
          <Field label="Linked requirements" className="sm:col-span-2" hint="Used for evidence freshness in the assessments and for findings">
            {canAny("catalog.read") ? <RequirementPicker value={f.requirement_ids} onChange={(v) => set("requirement_ids", v)} /> : <p className="text-[12.5px] text-ink-3">You cannot read the catalogue.</p>}
          </Field>
          <Field label="Legal basis" className="sm:col-span-2" htmlFor="act-legal">
            <Input id="act-legal" value={f.legal_refs} onChange={(e) => set("legal_refs", e.target.value)} maxLength={400} placeholder="e.g. IR 11.2.3; Cbb Art. 15(3)" />
          </Field>
          <Field label="Recurrence">
            <OptionSelect value={f.recurrence} onChange={(v) => { const r = (v ?? "quarterly") as Recurrence; setF((s) => ({ ...s, recurrence: r, anchor_month: ANCHOR_MAX[r] })) }}
              options={(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => ({ value: r, label: RECURRENCE_LABEL[r] }))} />
          </Field>
          {f.recurrence === "custom" ? (
            <Field label="Schedule rule" htmlFor="act-rrule" hint="FREQ=WEEKLY|MONTHLY|YEARLY; INTERVAL; BYDAY (weekly); BYMONTHDAY (-1 = last day); BYMONTH; DTSTART=YYYYMMDD">
              <Input id="act-rrule" className="font-mono text-[12.5px]" value={f.rrule} onChange={(e) => set("rrule", e.target.value)} />
            </Field>
          ) : f.recurrence === "monthly" ? (
            <Field label="Due date"><p className="pt-2 text-[13px] text-ink-2">Last day of each month</p></Field>
          ) : (
            <Field label={f.recurrence === "annual" ? "Due at the end of" : "Due in"}>
              <OptionSelect value={String(Math.min(f.anchor_month, ANCHOR_MAX[f.recurrence]))} onChange={(v) => set("anchor_month", Number(v ?? 1))} options={anchorOptions} />
            </Field>
          )}
          <Field label="Entities" className="sm:col-span-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-48">
                <OptionSelect value={f.entity_scope} onChange={(v) => set("entity_scope", (v ?? "all") as "all" | "list")}
                  options={[{ value: "all", label: "All active entities" }, { value: "list", label: "Selected entities" }]} />
              </div>
              {f.entity_scope === "list" && (entities.data ?? []).map((e) => (
                <label key={e.id} className="flex items-center gap-1.5 text-[13px]">
                  <Checkbox checked={f.entity_ids.includes(e.id)}
                    onCheckedChange={(v) => set("entity_ids", v ? [...f.entity_ids, e.id] : f.entity_ids.filter((x) => x !== e.id))} />
                  <span className="font-mono text-[12px] text-ink-2">{e.code}</span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Owner role">
            <StakeholderSelect value={f.owner_stakeholder_id} onChange={(v) => set("owner_stakeholder_id", v)} placeholder="Role or person…" />
          </Field>
          <Field label="Owner user" hint="Receives reminders and may record results">
            <UserSelect value={f.owner_user_id} onChange={(v) => set("owner_user_id", v)} placeholder="Choose user…" />
          </Field>
          <Field label="Required evidence" className="sm:col-span-2" htmlFor="act-evidence">
            <Textarea id="act-evidence" rows={2} value={f.required_evidence} onChange={(e) => set("required_evidence", e.target.value)} placeholder="What has to be kept as proof" />
          </Field>
          <Field label="Evidence valid for (days)" htmlFor="act-valid" hint="Older evidence counts as stale in the assessments">
            <Input id="act-valid" type="number" min={1} max={3650} value={f.evidence_validity_days} onChange={(e) => set("evidence_validity_days", Number(e.target.value) || 1)} />
          </Field>
          <Field label="Status">
            <div className="flex h-9 items-center gap-2">
              <Switch id="act-active" checked={f.active} onCheckedChange={(v) => set("active", v)} />
              <Label htmlFor="act-active" className="text-[13px] font-normal">{f.active ? "Active: occurrences are planned" : "Inactive: no new occurrences"}</Label>
            </div>
          </Field>
          {error && <ErrorState className="sm:col-span-2" error={error} />}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="activity-form" disabled={invalid || save.isPending}>
            {save.isPending ? "Saving…" : activity ? "Save changes" : "Create activity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
