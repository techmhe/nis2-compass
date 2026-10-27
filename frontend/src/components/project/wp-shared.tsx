import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Search, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Code, EntityTag, ErrorState, Loading, PriorityPill, StatusPill } from "@/components/common/basics"
import { EntitySelect, Field, OptionSelect, StakeholderSelect, UserSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities, useMainProject } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { MEASURE_AREAS, PRIORITY_VALUES, PROJECT_STATUS } from "@/lib/constants"
import type { ActionItem, WorkPackage } from "@/lib/types"
import { cn } from "@/lib/utils"

export function useActionItems(enabled = true) {
  const { canAny } = useAuth()
  return useQuery({ queryKey: ["action-items"], queryFn: () => api.get<ActionItem[]>("/action-items"), enabled: enabled && canAny("findings.read"), staleTime: 30_000 })
}

/** Dialog to pick action-plan findings (from any entity) to bundle into a work package. */
export function FindingsPicker({ open, onOpenChange, value, onConfirm, currentWpId }: {
  open: boolean; onOpenChange: (v: boolean) => void; value: number[]; onConfirm: (ids: number[]) => void; currentWpId?: number
}) {
  const items = useActionItems(open)
  const entities = useEntities()
  const [sel, setSel] = useState<number[]>(value)
  const [q, setQ] = useState("")
  const [entity, setEntity] = useState<number | null>(null)
  const [onlyFree, setOnlyFree] = useState(false)
  const [was, setWas] = useState(open)
  if (was !== open) { setWas(open); if (open) { setSel(value); setQ("") } }

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (items.data ?? []).filter((i) => (!entity || i.entity.id === entity)
      && (!onlyFree || i.work_packages.filter((w) => w.id !== currentWpId).length === 0)
      && (!t || `${i.code} ${i.title} ${i.requirement.number} ${i.requirement.section} ${i.finding_id ?? ""}`.toLowerCase().includes(t)))
  }, [items.data, q, entity, onlyFree, currentWpId])
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const selEntities = new Set((items.data ?? []).filter((i) => sel.includes(i.id)).map((i) => i.entity.code))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Select findings</DialogTitle>
          <DialogDescription>A work package can bundle findings from several entities, for example one central measure that closes the same gap everywhere.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, requirement or title" className="pl-8" aria-label="Search findings" />
          </div>
          <OptionSelect className="w-48" value={entity ? String(entity) : null} onChange={(v) => setEntity(v ? Number(v) : null)} allowNone noneLabel="All entities"
            options={(entities.data ?? []).map((e) => ({ value: String(e.id), label: `${e.code} ${e.name}` }))} />
          <label className="flex items-center gap-2 text-[13px] text-ink-2"><Switch checked={onlyFree} onCheckedChange={setOnlyFree} /> Not yet in a work package</label>
        </div>
        <div className="min-h-[240px] flex-1 overflow-y-auto rounded-md border scroll-thin">
          {items.isLoading ? <Loading /> : items.error ? <ErrorState error={items.error} className="m-3" /> : rows.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-ink-3">No findings match. Findings are created in the action plan from assessment gaps.</p>
          ) : (
            <ul>
              {rows.map((i) => {
                const other = i.work_packages.filter((w) => w.id !== currentWpId)
                return (
                  <li key={i.id} className="border-b last:border-0">
                    <label className={cn("flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-muted/50", sel.includes(i.id) && "bg-petrol-50/50")}>
                      <Checkbox className="mt-0.5" checked={sel.includes(i.id)} onCheckedChange={() => toggle(i.id)} aria-label={`Select ${i.code}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Code className="text-ink">{i.code}</Code>
                          <EntityTag code={i.entity.code} name={i.entity.name} />
                          <Code className="text-ink-3">{i.requirement.number}</Code>
                          <PriorityPill value={i.priority} />
                          <StatusPill value={i.status} />
                        </div>
                        <div className="mt-0.5 text-[13px] text-ink">{i.title}</div>
                        {other.length > 0 && <div className="mt-0.5 text-[12px] text-ink-3">Already in {other.map((w) => w.code).join(", ")}</div>}
                      </div>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <DialogFooter className="items-center">
          <span className="mr-auto text-[12.5px] text-ink-3">
            {sel.length} selected{selEntities.size > 1 ? ` across ${selEntities.size} entities` : ""}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { onConfirm(sel); onOpenChange(false) }}>Use {sel.length} finding{sel.length === 1 ? "" : "s"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Chips for selected findings, resolving codes from the action plan. */
export function SelectedFindings({ ids, onRemove }: { ids: number[]; onRemove?: (id: number) => void }) {
  const items = useActionItems(ids.length > 0)
  if (ids.length === 0) return <p className="text-[13px] text-ink-3">No findings selected.</p>
  const byId = new Map((items.data ?? []).map((i) => [i.id, i]))
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto scroll-thin">
      {ids.map((id) => {
        const i = byId.get(id)
        return (
          <li key={id} className="flex items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-[13px]">
            <Code>{i?.code ?? `#${id}`}</Code>
            {i && <EntityTag code={i.entity.code} name={i.entity.name} />}
            <span className="min-w-0 flex-1 truncate">{i?.title ?? "Loading…"}</span>
            {onRemove && <button className="text-ink-3 hover:text-alarm" aria-label={`Remove ${i?.code ?? id}`} onClick={() => onRemove(id)}><X className="size-3.5" /></button>}
          </li>
        )
      })}
    </ul>
  )
}

/** Pre-filled values, e.g. when bundling selected action plan items into a work package. */
export interface WorkPackagePreset {
  title?: string
  entity_id?: number | null
  priority?: string
  owner_stakeholder_id?: number | null
  planned_finish?: string
  finding_ids: number[]
}

export function NewWorkPackageDialog({ open, onOpenChange, preset }: { open: boolean; onOpenChange: (v: boolean) => void; preset?: WorkPackagePreset }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { me } = useAuth()
  const { project } = useMainProject()
  const init = () => ({
    title: "", description: "", entity_id: null as number | null, measure_area: null as string | null, central_or_local: "Central",
    priority: "Medium", owner_id: me?.id ?? null, owner_stakeholder_id: null as number | null, planned_start: "", planned_finish: "",
    acceptance_criterion: "", expected_evidence: "", status: "Not Started", finding_ids: [] as number[],
    ...(preset ? { ...preset, central_or_local: preset.entity_id ? "Local" : "Central" } : {}),
  })
  const [f, setF] = useState(init)
  const [picker, setPicker] = useState(false)
  const [was, setWas] = useState(open)
  if (was !== open) { setWas(open); if (open) setF(init()) }
  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) => setF((p) => ({ ...p, [k]: v }))
  const dateError = f.planned_start && f.planned_finish && f.planned_finish < f.planned_start

  const create = useMutation({
    mutationFn: () => api.post<WorkPackage>("/work-packages", {
      project_id: project?.id ?? null, title: f.title.trim(), description: f.description.trim() || null, entity_id: f.entity_id,
      measure_area: f.measure_area, central_or_local: f.central_or_local, priority: f.priority, owner_id: f.owner_id,
      owner_stakeholder_id: f.owner_stakeholder_id, planned_start: f.planned_start || null, planned_finish: f.planned_finish || null,
      acceptance_criterion: f.acceptance_criterion.trim() || null, expected_evidence: f.expected_evidence.trim() || null,
      status: f.status, progress: 0, progress_mode: "tasks", finding_ids: f.finding_ids,
    }),
    onSuccess: (w) => {
      toast.success(`Created ${w.code}`)
      for (const k of ["work-packages", "action-items", "gantt", "project-dashboard", "me-work"]) qc.invalidateQueries({ queryKey: [k] })
      onOpenChange(false)
      navigate(`/work-packages/${w.id}`)
    },
    onError: (e: Error) => toast.error(`Could not create the work package: ${e.message}`),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New work package</DialogTitle>
          <DialogDescription>Bundle findings into a deliverable with an owner, dates and an acceptance criterion.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
          <Field label="Title" className="col-span-2"><Input autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Roll out MFA for privileged access" /></Field>
          <Field label="Description" className="col-span-2"><Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label="Entity" hint="Leave group-wide for central measures that serve several entities.">
            <EntitySelect value={f.entity_id} onChange={(v) => { set("entity_id", v); set("central_or_local", v ? "Local" : "Central") }} groupLabel="Group-wide" />
          </Field>
          <Field label="Central or local">
            <OptionSelect value={f.central_or_local} onChange={(v) => set("central_or_local", v ?? "Central")} options={["Central", "Local"]} />
          </Field>
          <Field label="Measure area"><OptionSelect value={f.measure_area} onChange={(v) => set("measure_area", v)} options={MEASURE_AREAS} allowNone noneLabel="Not set" /></Field>
          <Field label="Priority"><OptionSelect value={f.priority} onChange={(v) => set("priority", v ?? "Medium")} options={PRIORITY_VALUES} /></Field>
          <Field label="Owner"><UserSelect value={f.owner_id} onChange={(v) => set("owner_id", v)} placeholder="Select owner…" /></Field>
          <Field label="Owner role"><StakeholderSelect value={f.owner_stakeholder_id} onChange={(v) => set("owner_stakeholder_id", v)} placeholder="Optional" /></Field>
          <Field label="Planned start"><Input type="date" value={f.planned_start} onChange={(e) => set("planned_start", e.target.value)} /></Field>
          <Field label="Planned finish" hint={dateError ? <span className="text-alarm">The finish is before the start.</span> : undefined}>
            <Input type="date" value={f.planned_finish} onChange={(e) => set("planned_finish", e.target.value)} />
          </Field>
          <Field label="Status"><OptionSelect value={f.status} onChange={(v) => set("status", v ?? "Not Started")} options={PROJECT_STATUS} /></Field>
          <div />
          <Field label="Acceptance criterion" className="col-span-2"><Textarea rows={2} value={f.acceptance_criterion} onChange={(e) => set("acceptance_criterion", e.target.value)} placeholder="When is this work package done?" /></Field>
          <Field label="Expected evidence" className="col-span-2"><Textarea rows={2} value={f.expected_evidence} onChange={(e) => set("expected_evidence", e.target.value)} /></Field>
        </div>
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[13.5px] font-semibold">Findings from the action plan</h3>
            <Button size="sm" variant="outline" onClick={() => setPicker(true)}>Select findings</Button>
          </div>
          <SelectedFindings ids={f.finding_ids} onRemove={(id) => set("finding_ids", f.finding_ids.filter((x) => x !== id))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!f.title.trim() || !!dateError || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create work package"}</Button>
        </DialogFooter>
        <FindingsPicker open={picker} onOpenChange={setPicker} value={f.finding_ids} onConfirm={(ids) => set("finding_ids", ids)} />
      </DialogContent>
    </Dialog>
  )
}
