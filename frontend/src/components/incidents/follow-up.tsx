import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ListPlus, ShieldAlert, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Code, Pill } from "@/components/common/basics"
import { Combo, Field, OptionSelect, UserSelect } from "@/components/common/fields"
import { useSupplierOptions } from "@/components/inventory/shared"
import { NewRiskDialog, type RiskDraft } from "@/components/risks/new-risk-dialog"
import { LevelPill, RiskStatusPill, useCanManageRisk, type Risk } from "@/components/risks/shared"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { PRIORITY_VALUES, TASK_STATUS_LABEL } from "@/lib/constants"
import { fmtDate } from "@/lib/format"
import type { ReportingOverview } from "./reporting-types"

interface IncidentRiskDraft {
  entity: { id: number; code: string; name: string } | null
  title: string
  scenario: string
  existing_controls: string | null
}

/**
 * Follow-up of an incident: involved suppliers (IR 5.1.4(d)), tasks created from the lessons learned and risks
 * created from the incident (Cbb Art. 8(2)(f) learning from incidents).
 */
export function FollowUpPanel({ data, incidentId, entityId, lessons, onChanged }: {
  data: ReportingOverview
  incidentId: number
  entityId: number | null
  lessons: string | null
  onChanged: (d: ReportingOverview) => void
}) {
  const { canAny } = useAuth()
  const canManageRisk = useCanManageRisk()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const suppliers = useSupplierOptions()
  const [taskOpen, setTaskOpen] = useState(false)
  const [riskOpen, setRiskOpen] = useState(false)

  const saveSuppliers = useMutation({
    mutationFn: (ids: number[]) => api.put<ReportingOverview>(`/incident-reporting/incidents/${incidentId}/profile`, {
      ...data.profile, affected_entity_ids: data.profile.affected_entity_ids, supplier_ids: ids,
    }),
    onSuccess: onChanged,
    onError: (e: Error) => toast.error(e.message),
  })
  const risks = useQuery({
    queryKey: ["risks", "linked", "incident", incidentId],
    queryFn: () => api.get<(Risk & { link_type: string })[]>("/risks/linked", { target_type: "incident", target_id: incidentId }),
    enabled: canAny("risks.read"),
  })
  const draft = useQuery({
    queryKey: ["risks", "from-incident", incidentId],
    queryFn: () => api.get<IncidentRiskDraft>(`/risks/from-incident/${incidentId}`),
    enabled: riskOpen,
  })
  const riskDraft: Partial<RiskDraft> | undefined = draft.data
    ? { entity_id: draft.data.entity?.id ?? null, title: draft.data.title, scenario: draft.data.scenario, existing_controls: draft.data.existing_controls ?? "" }
    : undefined

  const linkedIds = data.profile.supplier_ids ?? []
  const options = (suppliers.data ?? []).filter((s) => !linkedIds.includes(s.id)).map((s) => ({ value: s.id, label: s.name }))

  return (
    <div className="space-y-4">
      {canAny("suppliers.read") && (
        <div>
          <h3 className="mb-1.5 text-[13px] font-medium text-ink-2">Involved suppliers</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {data.suppliers.length === 0 && <span className="text-[13px] text-ink-3">None recorded.</span>}
            {data.suppliers.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 rounded-md border bg-surface px-2 py-0.5 text-[13px]">
                <Link to={`/suppliers/${s.id}`} className="hover:text-petrol">{s.name}</Link>
                {data.can_edit && (
                  <button type="button" aria-label={`Remove ${s.name}`} className="text-ink-3 hover:text-alarm"
                    onClick={() => saveSuppliers.mutate(linkedIds.filter((x) => x !== s.id))}><X className="size-3.5" /></button>
                )}
              </span>
            ))}
            {data.can_edit && (
              <div className="w-60"><Combo value={null} items={options} placeholder="Add supplier…" allowNone={false}
                onChange={(v) => v != null && saveSuppliers.mutate([...linkedIds, v])} /></div>
            )}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[13px] font-medium text-ink-2">Follow-up tasks</h3>
          {data.can_edit && <Button size="xs" variant="outline" onClick={() => setTaskOpen(true)}><ListPlus /> Create task</Button>}
        </div>
        {data.follow_up_tasks.length === 0 ? (
          <p className="text-[13px] text-ink-3">No follow-up tasks yet.{data.can_edit ? " Turn the lessons learned into tasks with an owner and a due date." : ""}</p>
        ) : (
          <ul className="space-y-1">
            {data.follow_up_tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-[13px]">
                <Code className="shrink-0">{t.key}</Code>
                <Link to={`/tasks?task=${t.id}`} className="min-w-0 flex-1 truncate text-ink hover:text-petrol">{t.title}</Link>
                {t.assignee && <span className="text-[12px] text-ink-3">{t.assignee}</span>}
                {t.due_date && <span className="text-[12px] text-ink-3">{fmtDate(t.due_date)}</span>}
                <Pill tone={t.status === "done" ? "sage" : "neutral"}>{TASK_STATUS_LABEL[t.status] ?? t.status}</Pill>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canAny("risks.read") && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-[13px] font-medium text-ink-2">Risks</h3>
            {canManageRisk(entityId) && (
              <Button size="xs" variant="outline" disabled={riskOpen && draft.isFetching} onClick={() => setRiskOpen(true)}>
                <ShieldAlert /> {riskOpen && draft.isFetching ? "Preparing…" : "Create risk from incident"}
              </Button>
            )}
          </div>
          {(risks.data ?? []).length === 0 ? (
            <p className="text-[13px] text-ink-3">No risk is linked to this incident.</p>
          ) : (
            <ul className="space-y-1">
              {(risks.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-[13px]">
                  <Code className="shrink-0">{r.code}</Code>
                  <Link to={`/risks/${r.id}`} className="min-w-0 flex-1 truncate text-ink hover:text-petrol">{r.title}</Link>
                  <span className="text-[11.5px] text-ink-3">Residual</span>
                  <LevelPill level={r.residual_level} />
                  <RiskStatusPill status={r.status} />
                </li>
              ))}
            </ul>
          )}
          {draft.error && <p className="mt-1 text-[12.5px] text-alarm">{(draft.error as Error).message}</p>}
        </div>
      )}

      <FollowUpTaskDialog open={taskOpen} onOpenChange={setTaskOpen} incidentId={incidentId} lessons={lessons} onCreated={onChanged} />
      <NewRiskDialog open={riskOpen && !!riskDraft} onOpenChange={setRiskOpen} draft={riskDraft} sourceIncidentId={incidentId} lockEntity={!!entityId}
        title="Create risk from incident" description="Prefilled from the root cause, impact and lessons learned. The incident is linked as an affected object."
        onCreated={(d) => {
          qc.invalidateQueries({ queryKey: ["risks", "linked", "incident", incidentId] })
          navigate(`/risks/${d.risk.id}`)
        }} />
    </div>
  )
}

function FollowUpTaskDialog({ open, onOpenChange, incidentId, lessons, onCreated }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  incidentId: number
  lessons: string | null
  onCreated: (d: ReportingOverview) => void
}) {
  const qc = useQueryClient()
  const { me } = useAuth()
  const init = () => ({ title: (lessons ?? "").split("\n")[0].slice(0, 200), description: lessons ?? "", assignee_id: me?.id ?? null as number | null, due_date: "", priority: "Medium" })
  const [f, setF] = useState(init)
  const [was, setWas] = useState(open)
  if (was !== open) { setWas(open); if (open) setF(init()) }
  const create = useMutation({
    mutationFn: () => api.post<ReportingOverview>(`/incident-reporting/incidents/${incidentId}/follow-up-tasks`, {
      title: f.title.trim(), description: f.description.trim() || null, assignee_id: f.assignee_id, due_date: f.due_date || null, priority: f.priority,
    }),
    onSuccess: (d) => {
      toast.success("Follow-up task created")
      for (const k of ["tasks", "me-work"]) qc.invalidateQueries({ queryKey: [k] })
      onCreated(d)
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create follow-up task</DialogTitle>
          <DialogDescription>The task appears on the task board and in the assignee's work list; the incident keeps a link to it.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title" className="col-span-2"><Input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={400} /></Field>
          <Field label="Description" className="col-span-2"><Textarea rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Assignee"><UserSelect value={f.assignee_id} onChange={(v) => setF({ ...f, assignee_id: v })} /></Field>
          <Field label="Due date"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label="Priority"><OptionSelect value={f.priority} onChange={(v) => setF({ ...f, priority: v ?? "Medium" })} options={PRIORITY_VALUES} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!f.title.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create task"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
