import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BookOpen, ListPlus, Pencil, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, EntityTag, ErrorState, KV, Loading, Pill, Section, StatusPill } from "@/components/common/basics"
import { CommentsPanel, Confirm, DocumentLinks, Markdown } from "@/components/common/collab"
import { Field, OptionSelect, Segmented, StakeholderSelect, UserSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { fmtDate, fromNow } from "@/lib/format"
import type { DocLink, EntityBrief } from "@/lib/types"
import {
  CritPill, EntityFilter, fmtHours, ManagedEntitySelect, matchesEntity, MultiCombo, numOrNull, ResultPill, SheetSection,
  TestStatePill, useAssets, useInventoryMeta, useOpenSheet, useParam, useServices, type ExerciseBrief, type Owner,
} from "./shared"

// --- types ----------------------------------------------------------------------------------------------

interface PlanRow {
  id: number; code: string; entity: EntityBrief | null; entity_id: number | null; title: string; plan_type: string
  owner: Owner | null; owner_id: number | null; version: string | null; status: string; last_tested: string | null
  test_interval_months: number; next_test_due: string | null; test_state: string; description: string | null
  services: { id: number; code: string; name: string; criticality: number }[]; service_ids: number[]
  exercise_count: number; last_result: string | null; updated_at: string; can_edit: boolean
}
interface PlanDetail extends PlanRow { exercises: ExerciseBrief[]; documents: DocLink[] }

interface ExerciseRow extends ExerciseBrief {
  entity: EntityBrief | null; entity_id: number | null; plan_id: number | null; plan: { id: number; code: string; title: string } | null
  participants: string | null; objectives: string | null; deviations: string | null; lessons_learned: string | null
  services: { id: number; code: string; name: string; rto_hours: number | null; rpo_hours: number | null }[]
  assets: { id: number; code: string; name: string }[]; service_ids: number[]; asset_ids: number[]
  actions: { kind: "action_item" | "task"; id: number; code: string; title: string; status: string; url: string }[]
  updated_at: string; can_edit: boolean
}
interface ExerciseDetail extends ExerciseRow { documents: DocLink[]; default_requirement: string | null }

const PLAN_TYPES: Record<string, string> = { BCP: "Business continuity plan", DRP: "Disaster recovery plan", crisis: "Crisis management plan", incident_response: "Incident response plan" }
const EXERCISE_TYPES: Record<string, string> = { tabletop: "Tabletop exercise", restore_test: "Backup restore test", failover: "Failover test", crisis_drill: "Crisis drill" }
const RESULT_LABEL: Record<string, string> = { passed: "Passed", partially: "Partially passed", failed: "Failed" }
const RESULT_KEY: Record<string, string> = { Passed: "passed", "Partially passed": "partially", Failed: "failed" }
const PLAN_STATUS: Record<string, string> = { draft: "Draft", approved: "Approved", retired: "Retired" }

function usePlans() {
  return useQuery({ queryKey: ["inv", "plans"], queryFn: () => api.get<PlanRow[]>("/inventory/plans") })
}
function useExercises() {
  return useQuery({ queryKey: ["inv", "exercises"], queryFn: () => api.get<ExerciseRow[]>("/inventory/exercises") })
}

function EntityCell({ e }: { e: EntityBrief | null }) {
  return e ? <EntityTag code={e.code} name={e.name} /> : <span className="text-[12.5px] text-ink-3">Group</span>
}

// --- tab ------------------------------------------------------------------------------------------------

export function PlansTab() {
  const { canAny } = useAuth()
  const meta = useInventoryMeta()
  const plans = usePlans()
  const exercises = useExercises()
  const openSheet = useOpenSheet()
  const [entity, setEntity] = useParam("entity")
  const [q, setQ] = useState("")
  const [type, setType] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [newPlan, setNewPlan] = useState(false)
  const [newExercise, setNewExercise] = useState(false)
  const canCreate = canAny("assets.manage")
  const needle = q.trim().toLowerCase()
  const planRows = useMemo(() => (plans.data ?? []).filter((p) => matchesEntity(entity, p.entity_id)
    && (!needle || `${p.code} ${p.title} ${p.owner?.name ?? ""}`.toLowerCase().includes(needle))), [plans.data, entity, needle])
  const exRows = useMemo(() => (exercises.data ?? []).filter((e) => matchesEntity(entity, e.entity_id)
    && (!type || e.exercise_type === type)
    && (!result || (result === "planned" ? e.result == null : e.result === result))
    && (!needle || `${e.code} ${e.title} ${e.plan?.code ?? ""}`.toLowerCase().includes(needle))), [exercises.data, entity, type, result, needle])
  const types = meta.data?.exercise_types ?? EXERCISE_TYPES

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[260px] min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plans and exercises" className="pl-8" aria-label="Search plans and exercises" />
        </div>
        <EntityFilter value={entity} onChange={setEntity} />
        {(q || entity) && <Button variant="ghost" size="sm" onClick={() => { setQ(""); setEntity(null) }}><X /> Clear filters</Button>}
      </div>

      <Section title="Continuity plans" bodyClassName="p-0"
        actions={canCreate && <Button size="sm" onClick={() => setNewPlan(true)}><Plus /> New plan</Button>}>
        {plans.isLoading ? <Loading /> : plans.error ? <ErrorState error={plans.error} className="m-4" /> : (plans.data ?? []).length === 0 ? (
          <Empty title="No continuity plans recorded" icon={<BookOpen className="size-6" />}
            action={canCreate && <Button size="sm" onClick={() => setNewPlan(true)}><Plus /> New plan</Button>}>
            Record business continuity, disaster recovery, crisis and incident response plans, link the plan document and the services they cover.
          </Empty>
        ) : planRows.length === 0 ? <Empty title="No plans match these filters" /> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[960px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">Plan</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">Entity</th>
                  <th className="px-2 py-2 font-medium">Owner</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Last tested</th>
                  <th className="px-2 py-2 font-medium">Next test</th>
                  <th className="px-2 py-2 pr-4 font-medium">Scope</th>
                </tr>
              </thead>
              <tbody>
                {planRows.map((p) => (
                  <tr key={p.id} className="cursor-pointer border-b align-top last:border-0 hover:bg-muted/50" onClick={() => openSheet("plan", p.id)}>
                    <td className="py-2 pr-2 pl-4">
                      <div className="flex items-baseline gap-2"><Code>{p.code}</Code>
                        <button className="text-left font-medium text-ink hover:text-petrol" onClick={(e) => { e.stopPropagation(); openSheet("plan", p.id) }}>{p.title}</button>
                      </div>
                      {p.version && <div className="ml-[4.2rem] text-[12px] text-ink-3">Version {p.version}</div>}
                    </td>
                    <td className="px-2 py-2 text-ink-2">{meta.data?.plan_types[p.plan_type] ?? PLAN_TYPES[p.plan_type] ?? p.plan_type}</td>
                    <td className="px-2 py-2"><EntityCell e={p.entity} /></td>
                    <td className="px-2 py-2 text-ink-2">{p.owner?.name ?? <span className="text-ink-3">–</span>}</td>
                    <td className="px-2 py-2"><StatusPill value={PLAN_STATUS[p.status] ?? p.status} /></td>
                    <td className="tabular px-2 py-2 text-ink-2">{p.last_tested ? fmtDate(p.last_tested) : <span className="text-ink-3">Never</span>}</td>
                    <td className="px-2 py-2"><div className="flex flex-col items-start gap-1">
                      <span className="tabular text-ink-2">{p.next_test_due ? fmtDate(p.next_test_due) : "–"}</span><TestStatePill state={p.test_state} /></div></td>
                    <td className="px-2 py-2 pr-4 text-[12.5px] text-ink-2">{p.services.length ? p.services.map((s) => s.name).join(", ") : <span className="text-alarm">No services</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Exercise and restore-test log" bodyClassName="p-0"
        actions={<div className="flex flex-wrap items-center gap-2">
          <OptionSelect size="sm" className="w-44" value={type} onChange={setType} allowNone noneLabel="All types" placeholder="All types"
            options={Object.entries(types).map(([value, label]) => ({ value, label }))} />
          <OptionSelect size="sm" className="w-40" value={result} onChange={setResult} allowNone noneLabel="All results" placeholder="All results"
            options={[{ value: "planned", label: "Planned" }, { value: "passed", label: "Passed" }, { value: "partially", label: "Partially passed" }, { value: "failed", label: "Failed" }]} />
          {canCreate && <Button size="sm" onClick={() => setNewExercise(true)}><Plus /> Log exercise</Button>}
        </div>}>
        {exercises.isLoading ? <Loading /> : exercises.error ? <ErrorState error={exercises.error} className="m-4" /> : (exercises.data ?? []).length === 0 ? (
          <Empty title="No exercises logged" icon={<ShieldCheck className="size-6" />}
            action={canCreate && <Button size="sm" onClick={() => setNewExercise(true)}><Plus /> Log exercise</Button>}>
            Log tabletop exercises, crisis drills, failover tests and backup restore tests with their result, deviations and follow-up actions (IR 2024/2690 points 4.1.4 and 4.2.6).
          </Empty>
        ) : exRows.length === 0 ? <Empty title="No exercises match these filters" /> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[960px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Exercise</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">Entity</th>
                  <th className="px-2 py-2 font-medium">Plan</th>
                  <th className="px-2 py-2 font-medium">Result</th>
                  <th className="px-2 py-2 text-right font-medium">Restored in</th>
                  <th className="px-2 py-2 pr-4 text-right font-medium">Follow-ups</th>
                </tr>
              </thead>
              <tbody>
                {exRows.map((e) => {
                  const rtoTarget = Math.min(...e.services.map((s) => s.rto_hours ?? Infinity))
                  const over = e.achieved_rto_hours != null && Number.isFinite(rtoTarget) && e.achieved_rto_hours > rtoTarget
                  return (
                    <tr key={e.id} className="cursor-pointer border-b align-top last:border-0 hover:bg-muted/50" onClick={() => openSheet("exercise", e.id)}>
                      <td className="tabular py-2 pr-2 pl-4 whitespace-nowrap text-ink-2">{fmtDate(e.exercise_date)}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-baseline gap-2"><Code>{e.code}</Code>
                          <button className="text-left font-medium text-ink hover:text-petrol" onClick={(ev) => { ev.stopPropagation(); openSheet("exercise", e.id) }}>{e.title}</button>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-ink-2">{types[e.exercise_type] ?? e.exercise_type}</td>
                      <td className="px-2 py-2"><EntityCell e={e.entity} /></td>
                      <td className="px-2 py-2">{e.plan ? <Code>{e.plan.code}</Code> : <span className="text-ink-3">–</span>}</td>
                      <td className="px-2 py-2"><ResultPill result={e.result} /></td>
                      <td className="tabular px-2 py-2 text-right">
                        <span className={over ? "font-medium text-alarm" : undefined}>{fmtHours(e.achieved_rto_hours)}</span>
                        {Number.isFinite(rtoTarget) && e.achieved_rto_hours != null && <div className="text-[11.5px] text-ink-3">target {fmtHours(rtoTarget)}</div>}
                      </td>
                      <td className="tabular px-2 py-2 pr-4 text-right">{e.actions.length || <span className="text-ink-3">0</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <PlanDialog open={newPlan} onOpenChange={setNewPlan} onSaved={(p) => openSheet("plan", p.id)} />
      <ExerciseDialog open={newExercise} onOpenChange={setNewExercise} onSaved={(e) => openSheet("exercise", e.id)} />
    </div>
  )
}

// --- plan dialog ----------------------------------------------------------------------------------------

interface PlanForm {
  entity_id: number | null; title: string; plan_type: string; owner_id: number | null; version: string; status: string
  last_tested: string; test_interval_months: string; next_test_due: string; description: string; service_ids: number[]
}
const planForm = (p?: PlanRow | null): PlanForm => ({
  entity_id: p?.entity_id ?? null, title: p?.title ?? "", plan_type: p?.plan_type ?? "BCP", owner_id: p?.owner_id ?? null,
  version: p?.version ?? "", status: p?.status ?? "draft", last_tested: p?.last_tested ?? "",
  test_interval_months: String(p?.test_interval_months ?? 12), next_test_due: p?.next_test_due ?? "", description: p?.description ?? "",
  service_ids: p?.service_ids ?? [],
})

export function PlanDialog({ open, onOpenChange, plan, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; plan?: PlanRow | null; onSaved?: (p: PlanDetail) => void }) {
  const qc = useQueryClient()
  const meta = useInventoryMeta()
  const services = useServices()
  const [f, setF] = useState<PlanForm>(() => planForm(plan))
  useEffect(() => { if (open) setF(planForm(plan)) }, [open, plan])
  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setF((p) => ({ ...p, [k]: v }))
  const save = useMutation({
    mutationFn: () => {
      const body = { entity_id: f.entity_id, title: f.title.trim(), plan_type: f.plan_type, owner_id: f.owner_id, version: f.version.trim() || null,
        status: f.status, last_tested: f.last_tested || null, test_interval_months: Math.max(1, Math.min(60, Number(f.test_interval_months) || 12)),
        next_test_due: f.next_test_due || null, description: f.description.trim() || null, service_ids: f.service_ids }
      return plan ? api.put<PlanDetail>(`/inventory/plans/${plan.id}`, body) : api.post<PlanDetail>("/inventory/plans", body)
    },
    onSuccess: (p) => { toast.success(plan ? "Plan saved" : `${p.code} created`); qc.invalidateQueries({ queryKey: ["inv"] }); onOpenChange(false); onSaved?.(p) },
    onError: (e: Error) => toast.error(e.message),
  })
  const svcItems = (services.data ?? []).filter((s) => s.status !== "retired")
    .map((s) => ({ value: s.id, label: `${s.code} ${s.name}`, hint: s.entity?.code ?? "Group" }))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{plan ? `Edit ${plan.code}` : "New continuity plan"}</DialogTitle>
          <DialogDescription>The plan document itself is linked in the plan's documents section; here you record scope, owner and the test cycle.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title" className="col-span-2" htmlFor="pl-title"><Input id="pl-title" value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="Type">
            <OptionSelect value={f.plan_type} onChange={(v) => set("plan_type", v ?? "BCP")}
              options={Object.entries(meta.data?.plan_types ?? PLAN_TYPES).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Entity"><ManagedEntitySelect value={f.entity_id} onChange={(v) => set("entity_id", v)} /></Field>
          <Field label="Owner"><StakeholderSelect value={f.owner_id} onChange={(v) => set("owner_id", v)} placeholder="Plan owner…" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Version" htmlFor="pl-version"><Input id="pl-version" value={f.version} onChange={(e) => set("version", e.target.value)} /></Field>
            <Field label="Status">
              <OptionSelect value={f.status} onChange={(v) => set("status", v ?? "draft")} options={Object.entries(PLAN_STATUS).map(([value, label]) => ({ value, label }))} />
            </Field>
          </div>
          <Field label="Last tested" htmlFor="pl-last" hint="Updated automatically by passed exercises"><Input id="pl-last" type="date" value={f.last_tested} onChange={(e) => set("last_tested", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Test every (months)" htmlFor="pl-int"><Input id="pl-int" inputMode="numeric" value={f.test_interval_months} onChange={(e) => set("test_interval_months", e.target.value)} /></Field>
            <Field label="Next test due" htmlFor="pl-next"><Input id="pl-next" type="date" value={f.next_test_due} onChange={(e) => set("next_test_due", e.target.value)} /></Field>
          </div>
          <Field label="Services in scope" className="col-span-2">
            <MultiCombo value={f.service_ids} onChange={(v) => set("service_ids", v)} items={svcItems} placeholder="Add services…" emptyText="No services in scope yet." />
          </Field>
          <Field label="Description" className="col-span-2" htmlFor="pl-desc"><Textarea id="pl-desc" rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!f.title.trim() || save.isPending} onClick={() => save.mutate()}>{plan ? "Save changes" : "Create plan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- exercise dialog ------------------------------------------------------------------------------------

interface ExForm {
  entity_id: number | null; plan_id: string | null; title: string; exercise_type: string; exercise_date: string; participants: string
  objectives: string; result: string | null; achieved_rto: string; achieved_rpo: string; deviations: string; lessons: string
  service_ids: number[]; asset_ids: number[]
}
const exForm = (e?: ExerciseRow | null): ExForm => ({
  entity_id: e?.entity_id ?? null, plan_id: e?.plan_id != null ? String(e.plan_id) : null, title: e?.title ?? "",
  exercise_type: e?.exercise_type ?? "restore_test", exercise_date: e?.exercise_date ?? new Date().toISOString().slice(0, 10),
  participants: e?.participants ?? "", objectives: e?.objectives ?? "", result: e?.result ?? null,
  achieved_rto: e?.achieved_rto_hours?.toString() ?? "", achieved_rpo: e?.achieved_rpo_hours?.toString() ?? "",
  deviations: e?.deviations ?? "", lessons: e?.lessons_learned ?? "", service_ids: e?.service_ids ?? [], asset_ids: e?.asset_ids ?? [],
})

export function ExerciseDialog({ open, onOpenChange, exercise, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; exercise?: ExerciseRow | null; onSaved?: (e: ExerciseDetail) => void }) {
  const qc = useQueryClient()
  const meta = useInventoryMeta()
  const services = useServices()
  const assets = useAssets()
  const plans = usePlans()
  const [f, setF] = useState<ExForm>(() => exForm(exercise))
  useEffect(() => { if (open) setF(exForm(exercise)) }, [open, exercise])
  const set = <K extends keyof ExForm>(k: K, v: ExForm[K]) => setF((p) => ({ ...p, [k]: v }))
  const save = useMutation({
    mutationFn: () => {
      const body = { entity_id: f.entity_id, plan_id: f.plan_id ? Number(f.plan_id) : null, title: f.title.trim(), exercise_type: f.exercise_type,
        exercise_date: f.exercise_date, participants: f.participants.trim() || null, objectives: f.objectives.trim() || null, result: f.result,
        achieved_rto_hours: numOrNull(f.achieved_rto), achieved_rpo_hours: numOrNull(f.achieved_rpo), deviations: f.deviations.trim() || null,
        lessons_learned: f.lessons.trim() || null, service_ids: f.service_ids, asset_ids: f.asset_ids }
      return exercise ? api.put<ExerciseDetail>(`/inventory/exercises/${exercise.id}`, body) : api.post<ExerciseDetail>("/inventory/exercises", body)
    },
    onSuccess: (e) => { toast.success(exercise ? "Exercise saved" : `${e.code} logged`); qc.invalidateQueries({ queryKey: ["inv"] }); onOpenChange(false); onSaved?.(e) },
    onError: (e: Error) => toast.error(e.message),
  })
  const restore = f.exercise_type === "restore_test" || f.exercise_type === "failover"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{exercise ? `Edit ${exercise.code}` : "Log exercise"}</DialogTitle>
          <DialogDescription>Leave the result empty for a planned exercise. A passed or partially passed exercise updates the plan's last test date.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title" className="col-span-2" htmlFor="ex-title"><Input id="ex-title" value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="Type">
            <OptionSelect value={f.exercise_type} onChange={(v) => set("exercise_type", v ?? "tabletop")}
              options={Object.entries(meta.data?.exercise_types ?? EXERCISE_TYPES).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Date" htmlFor="ex-date"><Input id="ex-date" type="date" value={f.exercise_date} onChange={(e) => set("exercise_date", e.target.value)} /></Field>
          <Field label="Entity"><ManagedEntitySelect value={f.entity_id} onChange={(v) => set("entity_id", v)} /></Field>
          <Field label="Continuity plan">
            <OptionSelect value={f.plan_id} onChange={(v) => set("plan_id", v)} allowNone noneLabel="No plan" placeholder="No plan"
              options={(plans.data ?? []).map((p) => ({ value: String(p.id), label: `${p.code} ${p.title}` }))} />
          </Field>
          <Field label="Services in scope" className="col-span-2">
            <MultiCombo value={f.service_ids} onChange={(v) => set("service_ids", v)} placeholder="Add services…" emptyText="No services selected."
              items={(services.data ?? []).map((s) => ({ value: s.id, label: `${s.code} ${s.name}`, hint: s.entity?.code ?? "Group" }))} />
          </Field>
          <Field label="Assets in scope" className="col-span-2">
            <MultiCombo value={f.asset_ids} onChange={(v) => set("asset_ids", v)} placeholder="Add assets…" emptyText="No assets selected."
              items={(assets.data ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}`, hint: a.entity?.code ?? "Group" }))} />
          </Field>
          <Field label="Objectives" className="col-span-2" htmlFor="ex-obj"><Textarea id="ex-obj" rows={2} value={f.objectives} onChange={(e) => set("objectives", e.target.value)} /></Field>
          <Field label="Participants" className="col-span-2" htmlFor="ex-part"><Input id="ex-part" value={f.participants} onChange={(e) => set("participants", e.target.value)} /></Field>
          <Field label="Result" className="col-span-2">
            <Segmented value={f.result ? RESULT_LABEL[f.result] : null} onChange={(v) => set("result", v ? RESULT_KEY[v] : null)}
              options={Object.values(RESULT_LABEL)}
              toneOf={(v) => (v === "Passed" ? "var(--petrol)" : v === "Partially passed" ? "var(--amber)" : "var(--alarm)")} />
            <p className="mt-1 text-[12px] text-ink-3">Click the selected result again to mark the exercise as planned.</p>
          </Field>
          {restore && (
            <>
              <Field label="Time to restore (h)" htmlFor="ex-rto" hint="Measured from start of recovery to service available">
                <Input id="ex-rto" inputMode="decimal" value={f.achieved_rto} onChange={(e) => set("achieved_rto", e.target.value)} />
              </Field>
              <Field label="Data loss window (h)" htmlFor="ex-rpo" hint="Age of the restored data">
                <Input id="ex-rpo" inputMode="decimal" value={f.achieved_rpo} onChange={(e) => set("achieved_rpo", e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Deviations" className="col-span-2" htmlFor="ex-dev"><Textarea id="ex-dev" rows={3} value={f.deviations} onChange={(e) => set("deviations", e.target.value)} /></Field>
          <Field label="Lessons learned" className="col-span-2" htmlFor="ex-less"><Textarea id="ex-less" rows={2} value={f.lessons} onChange={(e) => set("lessons", e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!f.title.trim() || !f.exercise_date || save.isPending} onClick={() => save.mutate()}>{exercise ? "Save changes" : "Log exercise"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- plan sheet -----------------------------------------------------------------------------------------

export function PlanSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  return (
    <Sheet open={id != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[640px]">
        {id != null && <PlanBody key={id} id={id} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function PlanBody({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient()
  const meta = useInventoryMeta()
  const openSheet = useOpenSheet()
  const [editing, setEditing] = useState(false)
  const q = useQuery({ queryKey: ["inv", "plan", id], queryFn: () => api.get<PlanDetail>(`/inventory/plans/${id}`) })
  const del = useMutation({
    mutationFn: () => api.del(`/inventory/plans/${id}`),
    onSuccess: () => { toast.success("Plan deleted"); qc.invalidateQueries({ queryKey: ["inv"] }); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  if (q.isLoading) return <><SheetHeader className="sr-only"><SheetTitle>Continuity plan</SheetTitle></SheetHeader><Loading /></>
  if (q.error || !q.data) return <div className="p-5"><SheetHeader className="p-0"><SheetTitle>Continuity plan</SheetTitle></SheetHeader><ErrorState error={q.error ?? "Not found"} className="mt-3" /></div>
  const p = q.data
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="border-b px-5 py-4 pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <Code className="text-[13px] font-medium text-ink">{p.code}</Code>
          {p.entity ? <EntityTag code={p.entity.code} name={p.entity.name} /> : <Pill tone="outline">Group-wide</Pill>}
          <StatusPill value={PLAN_STATUS[p.status] ?? p.status} />
          <TestStatePill state={p.test_state} />
        </div>
        <SheetTitle className="text-[16px] leading-snug">{p.title}</SheetTitle>
        <SheetDescription className="text-[12.5px]">{meta.data?.plan_types[p.plan_type] ?? PLAN_TYPES[p.plan_type]}. Updated {fromNow(p.updated_at)}</SheetDescription>
        {p.can_edit && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Edit plan</Button>
            <Confirm title={`Delete ${p.code}?`} confirmLabel="Delete plan" onConfirm={() => del.mutate()}
              description="Exercises stay in the log but lose their link to this plan."
              trigger={<Button size="sm" variant="outline" aria-label="Delete plan"><Trash2 /></Button>} />
          </div>
        )}
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto scroll-thin px-5 py-4">
        <section className="rounded-md border bg-surface px-3 py-1">
          <KV label="Owner">{p.owner?.name}</KV>
          <KV label="Version">{p.version}</KV>
          <KV label="Last tested">{p.last_tested ? fmtDate(p.last_tested) : "Never"}</KV>
          <KV label="Test cycle">Every {p.test_interval_months} months</KV>
          <KV label="Next test due">{p.next_test_due ? fmtDate(p.next_test_due) : null}</KV>
          {p.description && <KV label="Description"><span className="whitespace-pre-wrap">{p.description}</span></KV>}
        </section>
        <SheetSection title="Plan documents">
          <DocumentLinks targetType="continuity_plan" targetId={p.id} documents={p.documents} entityId={p.entity_id} canEdit={p.can_edit}
            onChange={() => qc.invalidateQueries({ queryKey: ["inv", "plan", id] })} />
        </SheetSection>
        <SheetSection title="Services in scope">
          {p.services.length === 0 ? <p className="text-[13px] text-alarm">No services in scope. Edit the plan to add the services it recovers.</p> : (
            <ul className="space-y-1">
              {p.services.map((s) => (
                <li key={s.id}>
                  <button className="flex w-full items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-left text-[13px] hover:bg-muted" onClick={() => openSheet("service", s.id)}>
                    <Code>{s.code}</Code><span className="min-w-0 flex-1 truncate text-ink">{s.name}</span><CritPill value={s.criticality} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SheetSection>
        <SheetSection title="Exercises">
          {p.exercises.length === 0 ? <p className="text-[13px] text-ink-3">No exercise has tested this plan yet.</p> : (
            <ul className="space-y-1">
              {p.exercises.map((e) => (
                <li key={e.id}>
                  <button className="flex w-full items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-left text-[13px] hover:bg-muted" onClick={() => openSheet("exercise", e.id)}>
                    <Code>{e.code}</Code><span className="min-w-0 flex-1 truncate text-ink">{e.title}</span>
                    <span className="tabular text-[12px] text-ink-3">{fmtDate(e.exercise_date)}</span><ResultPill result={e.result} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SheetSection>
        <SheetSection title="Comments"><CommentsPanel targetType="continuity_plan" targetId={p.id} canComment={p.can_edit} /></SheetSection>
      </div>
      <PlanDialog open={editing} onOpenChange={setEditing} plan={p} />
    </div>
  )
}

// --- exercise sheet -------------------------------------------------------------------------------------

export function ExerciseSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  return (
    <Sheet open={id != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[640px]">
        {id != null && <ExerciseBody key={id} id={id} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function ExerciseBody({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient()
  const meta = useInventoryMeta()
  const openSheet = useOpenSheet()
  const [editing, setEditing] = useState(false)
  const [followUp, setFollowUp] = useState(false)
  const q = useQuery({ queryKey: ["inv", "exercise", id], queryFn: () => api.get<ExerciseDetail>(`/inventory/exercises/${id}`) })
  const del = useMutation({
    mutationFn: () => api.del(`/inventory/exercises/${id}`),
    onSuccess: () => { toast.success("Exercise deleted"); qc.invalidateQueries({ queryKey: ["inv"] }); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  if (q.isLoading) return <><SheetHeader className="sr-only"><SheetTitle>Exercise</SheetTitle></SheetHeader><Loading /></>
  if (q.error || !q.data) return <div className="p-5"><SheetHeader className="p-0"><SheetTitle>Exercise</SheetTitle></SheetHeader><ErrorState error={q.error ?? "Not found"} className="mt-3" /></div>
  const e = q.data
  const restore = e.exercise_type === "restore_test" || e.exercise_type === "failover"
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="border-b px-5 py-4 pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <Code className="text-[13px] font-medium text-ink">{e.code}</Code>
          {e.entity ? <EntityTag code={e.entity.code} name={e.entity.name} /> : <Pill tone="outline">Group-wide</Pill>}
          <ResultPill result={e.result} />
        </div>
        <SheetTitle className="text-[16px] leading-snug">{e.title}</SheetTitle>
        <SheetDescription className="text-[12.5px]">{meta.data?.exercise_types[e.exercise_type] ?? EXERCISE_TYPES[e.exercise_type]} on {fmtDate(e.exercise_date)}</SheetDescription>
        {e.can_edit && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Edit exercise</Button>
            <Button size="sm" variant="outline" onClick={() => setFollowUp(true)}><ListPlus /> Create follow-up</Button>
            <Confirm title={`Delete ${e.code}?`} confirmLabel="Delete exercise" onConfirm={() => del.mutate()}
              trigger={<Button size="sm" variant="outline" aria-label="Delete exercise"><Trash2 /></Button>} />
          </div>
        )}
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto scroll-thin px-5 py-4">
        <section className="rounded-md border bg-surface px-3 py-1">
          <KV label="Continuity plan">{e.plan ? <button className="text-left hover:text-petrol" onClick={() => openSheet("plan", e.plan!.id)}><Code className="mr-1.5">{e.plan.code}</Code>{e.plan.title}</button> : null}</KV>
          <KV label="Participants">{e.participants}</KV>
          <KV label="Objectives">{e.objectives ? <span className="whitespace-pre-wrap">{e.objectives}</span> : null}</KV>
          {restore && <KV label="Time to restore"><span className="tabular">{fmtHours(e.achieved_rto_hours)}</span></KV>}
          {restore && <KV label="Data loss window"><span className="tabular">{fmtHours(e.achieved_rpo_hours)}</span></KV>}
        </section>
        {restore && e.services.length > 0 && (
          <SheetSection title="Targets of the services in scope">
            <table className="w-full text-[13px]">
              <thead><tr className="border-b text-left text-[12px] text-ink-3"><th className="py-1.5 font-medium">Service</th><th className="py-1.5 text-right font-medium">RTO target</th><th className="py-1.5 text-right font-medium">RPO target</th><th className="py-1.5 text-right font-medium">Met</th></tr></thead>
              <tbody>
                {e.services.map((s) => {
                  const rtoOk = e.achieved_rto_hours == null || s.rto_hours == null || e.achieved_rto_hours <= s.rto_hours
                  const rpoOk = e.achieved_rpo_hours == null || s.rpo_hours == null || e.achieved_rpo_hours <= s.rpo_hours
                  const met = e.result === "failed" ? false : rtoOk && rpoOk
                  return (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-1.5"><button className="text-left hover:text-petrol" onClick={() => openSheet("service", s.id)}><Code className="mr-1.5">{s.code}</Code>{s.name}</button></td>
                      <td className="tabular py-1.5 text-right">{fmtHours(s.rto_hours)}</td>
                      <td className="tabular py-1.5 text-right">{fmtHours(s.rpo_hours)}</td>
                      <td className="py-1.5 text-right">{met ? <Pill tone="sage">Yes</Pill> : <Pill tone="alarm">No</Pill>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </SheetSection>
        )}
        {!restore && e.services.length > 0 && (
          <SheetSection title="Services in scope">
            <div className="flex flex-wrap gap-1.5">
              {e.services.map((s) => <button key={s.id} className="rounded-[4px] border bg-surface px-2 py-0.5 text-[12.5px] hover:bg-muted" onClick={() => openSheet("service", s.id)}>{s.name}</button>)}
            </div>
          </SheetSection>
        )}
        {e.assets.length > 0 && (
          <SheetSection title="Assets in scope">
            <div className="flex flex-wrap gap-1.5">
              {e.assets.map((a) => <button key={a.id} className="inline-flex items-center gap-1.5 rounded-[4px] border bg-surface px-2 py-0.5 text-[12.5px] hover:bg-muted" onClick={() => openSheet("asset", a.id)}><Code className="text-[11.5px]">{a.code}</Code>{a.name}</button>)}
            </div>
          </SheetSection>
        )}
        <SheetSection title="Deviations">
          {e.deviations ? <Markdown className="prose-md text-[13px]">{e.deviations}</Markdown> : <p className="text-[13px] text-ink-3">No deviations recorded.</p>}
        </SheetSection>
        {e.lessons_learned && <SheetSection title="Lessons learned"><Markdown className="prose-md text-[13px]">{e.lessons_learned}</Markdown></SheetSection>}
        <SheetSection title="Follow-up actions" actions={e.can_edit && <Button size="xs" variant="outline" onClick={() => setFollowUp(true)}><Plus /> Create follow-up</Button>}>
          {e.actions.length === 0 ? (
            <p className="text-[13px] text-ink-3">{e.result === "failed" || e.result === "partially" ? "No follow-up yet. Turn each deviation into an action plan item or a task." : "No follow-up actions."}</p>
          ) : (
            <ul className="space-y-1">
              {e.actions.map((a) => (
                <li key={`${a.kind}-${a.id}`}>
                  <Link to={a.url} className="flex items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-[13px] hover:bg-muted">
                    <Code>{a.code}</Code><span className="min-w-0 flex-1 truncate text-ink">{a.title}</span>
                    <span className="text-[12px] text-ink-3">{a.kind === "task" ? "Task" : "Action plan"}</span><StatusPill value={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SheetSection>
        <SheetSection title="Evidence">
          <DocumentLinks targetType="exercise" targetId={e.id} documents={e.documents} entityId={e.entity_id} canEdit={e.can_edit}
            onChange={() => qc.invalidateQueries({ queryKey: ["inv", "exercise", id] })} />
        </SheetSection>
        <SheetSection title="Comments"><CommentsPanel targetType="exercise" targetId={e.id} canComment={e.can_edit} /></SheetSection>
      </div>
      <ExerciseDialog open={editing} onOpenChange={setEditing} exercise={e} />
      <FollowUpDialog open={followUp} onOpenChange={setFollowUp} exercise={e} />
    </div>
  )
}

function FollowUpDialog({ open, onOpenChange, exercise }: { open: boolean; onOpenChange: (o: boolean) => void; exercise: ExerciseDetail }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const entities = useEntities()
  const [kind, setKind] = useState<"action_item" | "task">("task")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [entityId, setEntityId] = useState<number | null>(exercise.entity_id)
  const [priority, setPriority] = useState("Medium")
  const [due, setDue] = useState("")
  const [responsible, setResponsible] = useState<number | null>(null)
  const [assignee, setAssignee] = useState<number | null>(null)
  const [req, setReq] = useState(exercise.default_requirement ?? "4.1.4")
  useEffect(() => {
    if (!open) return
    setTitle(""); setDescription(""); setEntityId(exercise.entity_id); setPriority("Medium"); setDue(""); setResponsible(null); setAssignee(null)
    setReq(exercise.default_requirement ?? "4.1.4")
    setKind(exercise.entity_id != null && can("findings.manage", exercise.entity_id) ? "action_item" : "task")
  }, [open, exercise, can])
  const create = useMutation({
    mutationFn: () => api.post<ExerciseDetail>(`/inventory/exercises/${exercise.id}/actions`, {
      kind, title: title.trim(), description: description.trim() || null, entity_id: entityId, priority, due_date: due || null,
      responsible_id: kind === "action_item" ? responsible : null, assignee_id: kind === "task" ? assignee : null,
      requirement_number: kind === "action_item" ? req.trim() || null : null,
    }),
    onSuccess: (d) => {
      toast.success(kind === "task" ? "Task created" : "Action plan item created")
      qc.setQueryData(["inv", "exercise", exercise.id], d)
      qc.invalidateQueries({ queryKey: ["inv", "exercises"] })
      qc.invalidateQueries({ queryKey: kind === "task" ? ["tasks"] : ["action-items"] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const findingsEntities = (entities.data ?? []).filter((x) => can("findings.manage", x.id))
  const canItem = findingsEntities.length > 0
  const valid = title.trim() && (kind === "task" || (entityId != null && can("findings.manage", entityId) && req.trim()))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create follow-up for {exercise.code}</DialogTitle>
          <DialogDescription>Corrective actions from exercises and restore tests must be documented and tracked (IR 2024/2690 point 4.2.6).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Create as">
            <Segmented value={kind === "task" ? "Task" : "Action plan item"} onChange={(v) => v && setKind(v === "Task" ? "task" : "action_item")}
              options={canItem ? ["Action plan item", "Task"] : ["Task"]}
              toneOf={() => "var(--petrol)"} />
          </Field>
          <Field label="Title" htmlFor="fu-title"><Input id="fu-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Add the database volume to the MES backup job" /></Field>
          <Field label="Description" htmlFor="fu-desc"><Textarea id="fu-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Entity">
              {kind === "action_item" ? (
                <OptionSelect value={entityId != null ? String(entityId) : null} onChange={(v) => setEntityId(v ? Number(v) : null)} placeholder="Choose an entity"
                  options={findingsEntities.map((x) => ({ value: String(x.id), label: <span><span className="font-mono text-[12px] text-ink-3">{x.code}</span> {x.name}</span> }))} />
              ) : <ManagedEntitySelect value={entityId} onChange={setEntityId} />}
            </Field>
            <Field label="Priority">
              <OptionSelect value={priority} onChange={(v) => setPriority(v ?? "Medium")} options={["High", "Medium", "Low"]} />
            </Field>
            {kind === "action_item" ? (
              <>
                <Field label="Responsible"><StakeholderSelect value={responsible} onChange={setResponsible} /></Field>
                <Field label="Requirement" htmlFor="fu-req" hint="Catalogue number"><Input id="fu-req" className="font-mono" value={req} onChange={(e) => setReq(e.target.value)} /></Field>
              </>
            ) : (
              <Field label="Assignee" className="col-span-2"><UserSelect value={assignee} onChange={setAssignee} /></Field>
            )}
            <Field label={kind === "task" ? "Due date" : "Target date"} htmlFor="fu-due"><Input id="fu-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>{kind === "task" ? "Create task" : "Create action plan item"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
