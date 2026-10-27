import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Link } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus, Search, Server, Trash2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, EntityTag, ErrorState, KV, Loading, Pill, StatusPill } from "@/components/common/basics"
import { CommentsPanel, Confirm, DocumentLinks } from "@/components/common/collab"
import { Field, OptionSelect, StakeholderSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate, fromNow } from "@/lib/format"
import { ImportWizard } from "./import-wizard"
import {
  BiaStatePill, CoveragePill, CritPill, CRIT_LABEL, EntityFilter, fmtHours, HistoryList, LifecyclePill, ManagedEntitySelect,
  matchesEntity, MultiCombo, numOrNull, ResultPill, SheetSection, tagsFromText, useAssets, useInventoryMeta, useOpenSheet,
  useParam, useServices, SupplierRef, useSupplierOptions, type ServiceDetail, type ServiceRow,
} from "./shared"

export function ServicesTab() {
  const { canAny } = useAuth()
  const list = useServices()
  const openSheet = useOpenSheet()
  const [q, setQ] = useState("")
  const [entity, setEntity] = useParam("entity")
  const [crit, setCrit] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>("active")
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const all = useMemo(() => list.data ?? [], [list.data])
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all.filter((s) => matchesEntity(entity, s.entity_id)
      && (!crit || String(s.criticality) === crit)
      && (!status || s.status === status)
      && (!needle || `${s.code} ${s.name} ${s.description ?? ""} ${s.owner?.name ?? ""} ${s.tags.join(" ")}`.toLowerCase().includes(needle)))
      .sort((a, b) => b.criticality - a.criticality || a.name.localeCompare(b.name))
  }, [all, q, entity, crit, status])
  const canCreate = canAny("assets.manage")
  const filtersActive = !!(q || entity || crit || status !== "active")

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[280px] min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, name, owner, tag" className="pl-8" aria-label="Search services" />
        </div>
        <EntityFilter value={entity} onChange={setEntity} />
        <OptionSelect className="w-40" value={crit} onChange={setCrit} allowNone noneLabel="All criticalities" placeholder="All criticalities"
          options={[4, 3, 2, 1].map((c) => ({ value: String(c), label: CRIT_LABEL[c] }))} />
        <OptionSelect className="w-36" value={status} onChange={setStatus} allowNone noneLabel="All statuses" placeholder="All statuses"
          options={[{ value: "active", label: "Active" }, { value: "planned", label: "Planned" }, { value: "retired", label: "Retired" }]} />
        {filtersActive && <Button variant="ghost" size="sm" onClick={() => { setQ(""); setEntity(null); setCrit(null); setStatus("active") }}><X /> Clear filters</Button>}
        <div className="ml-auto flex gap-2">
          {canCreate && <Button variant="outline" onClick={() => setImporting(true)}><Upload /> Import</Button>}
          {canCreate && <Button onClick={() => setCreating(true)}><Plus /> New service</Button>}
        </div>
      </div>
      <div className="rounded-md border bg-card">
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} className="m-4" /> : all.length === 0 ? (
          <Empty title="No services recorded" icon={<Server className="size-6" />}
            action={canCreate && <Button size="sm" onClick={() => setCreating(true)}><Plus /> New service</Button>}>
            Record the business services and processes of each entity, then link the assets and suppliers they depend on.
          </Empty>
        ) : rows.length === 0 ? <Empty title="No services match these filters">Remove a filter or search for something else.</Empty> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[1000px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">Service</th>
                  <th className="px-2 py-2 font-medium">Entity</th>
                  <th className="px-2 py-2 font-medium">Criticality</th>
                  <th className="px-2 py-2 font-medium">Owner</th>
                  <th className="px-2 py-2 text-right font-medium">RTO</th>
                  <th className="px-2 py-2 text-right font-medium">RPO</th>
                  <th className="px-2 py-2 text-right font-medium">Assets</th>
                  <th className="px-2 py-2 font-medium">BIA</th>
                  <th className="px-2 py-2 pr-4 font-medium">Restore test</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="cursor-pointer border-b align-top last:border-0 hover:bg-muted/50" onClick={() => openSheet("service", s.id)}>
                    <td className="py-2 pr-2 pl-4">
                      <div className="flex items-baseline gap-2">
                        <Code className="shrink-0">{s.code}</Code>
                        <div className="min-w-0">
                          <button className="text-left font-medium text-ink hover:text-petrol" onClick={(e) => { e.stopPropagation(); openSheet("service", s.id) }}>{s.name}</button>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {s.kind === "process" && <Pill tone="outline">Process</Pill>}
                            {s.nis2_relevant && <Pill tone="petrol">NIS2</Pill>}
                            {s.status !== "active" && <StatusPill value={s.status === "retired" ? "Retired" : "Planned"} />}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2">{s.entity ? <EntityTag code={s.entity.code} name={s.entity.name} /> : <span className="text-[12.5px] text-ink-3">Group</span>}</td>
                    <td className="px-2 py-2"><CritPill value={s.criticality} /></td>
                    <td className="px-2 py-2 text-ink-2">{s.owner?.name ?? <span className="text-alarm">No owner</span>}</td>
                    <td className="tabular px-2 py-2 text-right">{fmtHours(s.rto_hours)}</td>
                    <td className="tabular px-2 py-2 text-right">{fmtHours(s.rpo_hours)}</td>
                    <td className="tabular px-2 py-2 text-right">{s.asset_ids.length || <span className="text-ink-3">0</span>}</td>
                    <td className="px-2 py-2"><BiaStatePill bia={s.bia} /></td>
                    <td className="px-2 py-2 pr-4">{s.criticality >= 3 ? <CoveragePill state={s.restore_state} /> : <span className="text-[12px] text-ink-3">Not required</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mt-2 text-[12px] text-ink-3">{rows.length} of {all.length} services. Restore tests are tracked for services of high or critical criticality.</p>
      <ServiceDialog open={creating} onOpenChange={setCreating} onSaved={(s) => openSheet("service", s.id)} />
      <ImportWizard open={importing} onOpenChange={setImporting} defaultKind="services" />
    </div>
  )
}

// --- create / edit dialog -------------------------------------------------------------------------------

interface ServiceForm {
  entity_id: number | null; name: string; description: string; kind: string; criticality: number; nis2_relevant: boolean
  owner_id: number | null; rto: string; rpo: string; status: string; tags: string; notes: string
}

const emptyForm = (): ServiceForm => ({ entity_id: null, name: "", description: "", kind: "service", criticality: 2, nis2_relevant: true,
  owner_id: null, rto: "", rpo: "", status: "active", tags: "", notes: "" })

const toForm = (s: ServiceRow): ServiceForm => ({
  entity_id: s.entity_id, name: s.name, description: s.description ?? "", kind: s.kind, criticality: s.criticality,
  nis2_relevant: s.nis2_relevant, owner_id: s.owner_id, rto: s.rto_hours?.toString() ?? "", rpo: s.rpo_hours?.toString() ?? "",
  status: s.status, tags: s.tags.join(", "), notes: s.notes ?? "",
})

export function ServiceDialog({ open, onOpenChange, service, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; service?: ServiceRow; onSaved?: (s: ServiceDetail) => void
}) {
  const qc = useQueryClient()
  const { canGlobal, me } = useAuth()
  const [f, setF] = useState<ServiceForm>(emptyForm)
  useEffect(() => {
    if (!open) return
    if (service) setF(toForm(service))
    else {
      const first = Object.keys(me?.entity_permissions ?? {}).find((k) => me?.entity_permissions[k]?.includes("assets.manage"))
      setF({ ...emptyForm(), entity_id: canGlobal("assets.manage") ? null : first ? Number(first) : null })
    }
  }, [open, service, canGlobal, me])
  const set = <K extends keyof ServiceForm>(k: K, v: ServiceForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const save = useMutation({
    mutationFn: () => {
      const body = {
        entity_id: f.entity_id, name: f.name.trim(), description: f.description.trim() || null, kind: f.kind, criticality: f.criticality,
        nis2_relevant: f.nis2_relevant, owner_id: f.owner_id, rto_hours: numOrNull(f.rto), rpo_hours: numOrNull(f.rpo), status: f.status,
        tags: tagsFromText(f.tags), notes: f.notes.trim() || null,
      }
      return service ? api.put<ServiceDetail>(`/inventory/services/${service.id}`, body) : api.post<ServiceDetail>("/inventory/services", body)
    },
    onSuccess: (s) => {
      toast.success(service ? `${s.code} saved` : `${s.code} created`)
      qc.invalidateQueries({ queryKey: ["inv"] })
      onOpenChange(false)
      onSaved?.(s)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const badNum = (f.rto.trim() && numOrNull(f.rto) == null) || (f.rpo.trim() && numOrNull(f.rpo) == null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{service ? `Edit ${service.code}` : "New service or process"}</DialogTitle>
          <DialogDescription>Services with criticality high or critical need an approved BIA, a continuity plan and regular restore tests.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto scroll-thin pr-1">
          <Field label="Name" className="col-span-2" htmlFor="svc-name"><Input id="svc-name" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus /></Field>
          <Field label="Entity"><ManagedEntitySelect value={f.entity_id} onChange={(v) => set("entity_id", v)} /></Field>
          <Field label="Kind"><OptionSelect value={f.kind} onChange={(v) => v && set("kind", v)} options={[{ value: "service", label: "Service" }, { value: "process", label: "Process" }]} /></Field>
          <Field label="Criticality"><OptionSelect value={String(f.criticality)} onChange={(v) => v && set("criticality", Number(v))}
            options={[4, 3, 2, 1].map((c) => ({ value: String(c), label: `${c} ${CRIT_LABEL[c]}` }))} /></Field>
          <Field label="Status"><OptionSelect value={f.status} onChange={(v) => v && set("status", v)}
            options={[{ value: "active", label: "Active" }, { value: "planned", label: "Planned" }, { value: "retired", label: "Retired" }]} /></Field>
          <Field label="Owner"><StakeholderSelect value={f.owner_id} onChange={(v) => set("owner_id", v)} placeholder="Owner…" /></Field>
          <div className="flex items-end pb-2">
            <div className="flex items-center gap-2">
              <Switch id="svc-nis2" checked={f.nis2_relevant} onCheckedChange={(v) => set("nis2_relevant", v)} />
              <Label htmlFor="svc-nis2" className="text-[13px] font-normal text-ink-2">Relevant for NIS2 scope</Label>
            </div>
          </div>
          <Field label="RTO target (hours)" htmlFor="svc-rto" hint="Recovery time objective"><Input id="svc-rto" inputMode="decimal" value={f.rto} onChange={(e) => set("rto", e.target.value)} /></Field>
          <Field label="RPO target (hours)" htmlFor="svc-rpo" hint="Maximum tolerable data loss"><Input id="svc-rpo" inputMode="decimal" value={f.rpo} onChange={(e) => set("rpo", e.target.value)} /></Field>
          <Field label="Description" className="col-span-2" htmlFor="svc-desc"><Textarea id="svc-desc" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label="Tags" hint="Comma separated" className="col-span-2" htmlFor="svc-tags"><Input id="svc-tags" value={f.tags} onChange={(e) => set("tags", e.target.value)} /></Field>
          <Field label="Notes" className="col-span-2" htmlFor="svc-notes"><Textarea id="svc-notes" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        </div>
        {badNum && <p className="text-[12.5px] text-alarm">RTO and RPO must be numbers of hours.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!f.name.trim() || !!badNum || save.isPending} onClick={() => save.mutate()}>{service ? "Save changes" : "Create service"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- detail sheet ---------------------------------------------------------------------------------------

export function ServiceSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  return (
    <Sheet open={id != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[680px]">
        {id != null && <ServiceBody key={id} id={id} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function ServiceBody({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient()
  const openSheet = useOpenSheet()
  const q = useQuery({ queryKey: ["inv", "service", id], queryFn: () => api.get<ServiceDetail>(`/inventory/services/${id}`) })
  const [editing, setEditing] = useState(false)
  const del = useMutation({
    mutationFn: () => api.del(`/inventory/services/${id}`),
    onSuccess: () => { toast.success("Service deleted"); qc.invalidateQueries({ queryKey: ["inv"] }); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  if (q.isLoading) return <><SheetHeader className="sr-only"><SheetTitle>Service</SheetTitle></SheetHeader><Loading /></>
  if (q.error || !q.data) return <div className="p-5"><SheetHeader className="p-0"><SheetTitle>Service</SheetTitle></SheetHeader><ErrorState error={q.error ?? "Not found"} className="mt-3" /></div>
  const s = q.data
  const refresh = () => qc.invalidateQueries({ queryKey: ["inv"] })
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="border-b px-5 py-4 pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <Code className="text-[13px] font-medium text-ink">{s.code}</Code>
          {s.entity ? <EntityTag code={s.entity.code} name={s.entity.name} /> : <Pill tone="outline">Group-wide</Pill>}
          <CritPill value={s.criticality} />
          {s.nis2_relevant && <Pill tone="petrol">NIS2</Pill>}
          {s.kind === "process" && <Pill tone="outline">Process</Pill>}
        </div>
        <SheetTitle className="text-[16px] leading-snug">{s.name}</SheetTitle>
        <SheetDescription className="text-[12.5px]">Updated {fromNow(s.updated_at)}</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto scroll-thin px-5 py-4">
        <section className="rounded-md border bg-surface px-3 py-1">
          <KV label="Description">{s.description}</KV>
          <KV label="Owner">{s.owner?.name ?? <span className="text-alarm">No owner</span>}</KV>
          <KV label="Status">{s.status === "active" ? "Active" : s.status === "planned" ? "Planned" : "Retired"}</KV>
          <KV label="RTO / RPO target"><span className="tabular">{fmtHours(s.rto_hours)} / {fmtHours(s.rpo_hours)}</span></KV>
          <KV label="Restore readiness">
            {s.coverage ? (
              <span className="flex flex-wrap items-center gap-2">
                <CoveragePill state={s.coverage.state} />
                {s.coverage.last_success && <span className="text-[12.5px] text-ink-2">Last success {fmtDate(s.coverage.last_success.date)}, restored in {fmtHours(s.coverage.last_success.achieved_rto_hours)}</span>}
              </span>
            ) : null}
          </KV>
          <KV label="Tags">{s.tags.length ? s.tags.join(", ") : null}</KV>
          <KV label="Notes">{s.notes}</KV>
        </section>

        <DependenciesEditor service={s} onSaved={refresh} />

        <SheetSection title="Business impact analysis">
          {s.bia_items.length === 0 ? <p className="text-[13px] text-ink-3">Not part of any BIA yet.</p> : (
            <ul className="space-y-1">
              {s.bia_items.map((b) => (
                <li key={b.item_id} className="flex flex-wrap items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-[13px]">
                  <Link to={`/inventory/bia/${b.bia_id}`} className="font-medium text-ink hover:text-petrol">BIA {b.period}</Link>
                  {b.entity && <EntityTag code={b.entity.code} />}
                  <StatusPill value={b.status === "approved" ? "Approved" : "Draft"} />
                  <span className="tabular ml-auto text-[12.5px] text-ink-2">MTPD {fmtHours(b.mtpd_hours)}, RTO {fmtHours(b.rto_hours)}, RPO {fmtHours(b.rpo_hours)}</span>
                </li>
              ))}
            </ul>
          )}
        </SheetSection>

        <SheetSection title="Continuity plans">
          {s.plans.length === 0 ? <p className="text-[13px] text-ink-3">No continuity plan covers this service.</p> : (
            <ul className="space-y-1">
              {s.plans.map((p) => (
                <li key={p.id}>
                  <button className="flex w-full items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-left text-[13px] hover:bg-muted" onClick={() => openSheet("plan", p.id)}>
                    <Code>{p.code}</Code><span className="min-w-0 flex-1 truncate text-ink">{p.title}</span>
                    <span className="text-[12px] text-ink-3">Last tested {fmtDate(p.last_tested, "never")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SheetSection>

        <SheetSection title="Exercises and restore tests">
          {s.exercises.length === 0 ? <p className="text-[13px] text-ink-3">No exercise covered this service yet.</p> : (
            <ul className="space-y-1">
              {s.exercises.map((e) => (
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

        <SheetSection title="Documents">
          <DocumentLinks targetType="service" targetId={s.id} documents={s.documents} entityId={s.entity_id} canEdit={s.can_edit} onChange={refresh} />
        </SheetSection>
        <SheetSection title="Discussion"><CommentsPanel targetType="service" targetId={s.id} canComment={s.can_edit} /></SheetSection>
        <SheetSection title="Change history"><HistoryList events={s.history} /></SheetSection>
      </div>
      {s.can_edit && (
        <div className="flex items-center gap-2 border-t bg-card px-5 py-3">
          <Confirm title={`Delete ${s.code}?`} description="The service, its dependencies, comments and document links are removed. BIA items keep their text but lose the link."
            confirmLabel="Delete service" onConfirm={() => del.mutate()}
            trigger={<Button variant="ghost" className="text-alarm hover:bg-alarm-50 hover:text-alarm" disabled={del.isPending}><Trash2 /> Delete</Button>} />
          <Button className="ml-auto" onClick={() => setEditing(true)}><Pencil /> Edit service</Button>
        </div>
      )}
      <ServiceDialog open={editing} onOpenChange={setEditing} service={s} />
    </div>
  )
}

function DependenciesEditor({ service, onSaved }: { service: ServiceDetail; onSaved: () => void }) {
  const { canAny } = useAuth()
  const meta = useInventoryMeta()
  const openSheet = useOpenSheet()
  const [editing, setEditing] = useState(false)
  const [assetIds, setAssetIds] = useState<number[]>(service.asset_ids)
  const [supplierIds, setSupplierIds] = useState<number[]>(service.supplier_ids)
  const assets = useAssets()
  const suppliers = useSupplierOptions()
  useEffect(() => { setAssetIds(service.asset_ids); setSupplierIds(service.supplier_ids) }, [service])
  const save = useMutation({
    mutationFn: () => api.put(`/inventory/services/${service.id}/dependencies`, { asset_ids: assetIds, supplier_ids: supplierIds }),
    onSuccess: () => { toast.success("Dependencies saved"); setEditing(false); onSaved() },
    onError: (e: Error) => toast.error(e.message),
  })
  const assetItems = (assets.data ?? []).filter((a) => a.lifecycle !== "retired" || assetIds.includes(a.id))
    .map((a) => ({ value: a.id, label: `${a.code} ${a.name}`, hint: a.entity?.code ?? "Group" }))
  const supplierItems = (suppliers.data ?? []).filter((s) => s.status !== "offboarded" || supplierIds.includes(s.id))
    .map((s) => ({ value: s.id, label: `${s.code} ${s.name}`, hint: s.tier }))
  let body: ReactNode
  if (editing) {
    body = (
      <div className="space-y-3 rounded-md border bg-surface p-3">
        <Field label="Supporting assets"><MultiCombo value={assetIds} onChange={setAssetIds} items={assetItems} placeholder="Add asset…" emptyText="No assets linked." /></Field>
        {canAny("suppliers.read") && (
          <Field label="Suppliers (direct dependencies)" hint="Suppliers of linked assets count automatically.">
            <MultiCombo value={supplierIds} onChange={setSupplierIds} items={supplierItems} unknownLabel="Hidden supplier" placeholder="Add supplier…" emptyText="No direct supplier dependencies." />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => { setEditing(false); setAssetIds(service.asset_ids); setSupplierIds(service.supplier_ids) }}>Cancel</Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save dependencies</Button>
        </div>
      </div>
    )
  } else {
    body = (
      <div className="space-y-2">
        {service.assets.length === 0 && service.suppliers.length === 0 && <p className="text-[13px] text-ink-3">No dependencies recorded.</p>}
        {service.assets.length > 0 && (
          <ul className="space-y-1">
            {service.assets.map((a) => (
              <li key={a.id}>
                <button className="flex w-full items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-left text-[13px] hover:bg-muted" onClick={() => openSheet("asset", a.id)}>
                  <Code>{a.code}</Code><span className="min-w-0 flex-1 truncate text-ink">{a.name}</span>
                  <span className="text-[12px] text-ink-3">{meta.data?.asset_types[a.asset_type] ?? a.asset_type}</span>
                  {a.lifecycle !== "in_operation" && <LifecyclePill value={a.lifecycle} label={meta.data?.lifecycle[a.lifecycle]} />}
                  {a.supplier && <span className="truncate text-[12px] text-ink-2">{a.supplier.hidden ? "Hidden supplier" : a.supplier.name}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {service.suppliers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-ink-3">Direct suppliers:</span>
            {service.suppliers.map((s) => <SupplierRef key={s.id} s={s} className="text-ink hover:text-petrol" />)}
          </div>
        )}
      </div>
    )
  }
  return (
    <SheetSection title="Dependencies" actions={service.can_edit && !editing && <Button size="xs" variant="outline" onClick={() => setEditing(true)}><Pencil /> Edit dependencies</Button>}>
      {body}
    </SheetSection>
  )
}
