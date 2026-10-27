import { Fragment, useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, EntityTag, ErrorState, Loading, Pill, Section } from "@/components/common/basics"
import { CommentsPanel, Confirm, DocumentLinks } from "@/components/common/collab"
import { Combo, Field, OptionSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { fmtDate, fmtDateTime } from "@/lib/format"
import type { DocLink, EntityBrief } from "@/lib/types"
import { cn } from "@/lib/utils"
import { CritPill, fmtHours, numOrNull, useInventoryMeta, useOpenSheet, type SupplierBrief } from "./shared"

// --- types ----------------------------------------------------------------------------------------------

type Impacts = Record<string, Record<string, number>>

interface BiaSummary {
  id: number; entity: EntityBrief | null; entity_id: number; period: string; title: string | null; status: string
  approved_at: string | null; approved_by: string | null; next_review: string | null; notes: string | null
  item_count: number; items_with_warnings: number; updated_at: string; can_edit: boolean
  created_by: string | null; updated_by: string | null; can_approve: boolean
}

interface BiaItem {
  id: number; service_id: number | null
  service: { id: number; code: string; name: string; criticality: number; rto_hours: number | null; rpo_hours: number | null } | null
  process_name: string | null; label: string; impacts: Impacts
  mtpd_hours_manual: number | null; rto_hours_manual: number | null; rpo_hours_manual: number | null
  mtpd_hours: number | null; rto_hours: number | null; rpo_hours: number | null
  derived: { mtpd_hours: number | null; rto_hours: number | null; rpo_hours: number | null; criticality: number; windows: { window: string; max: number }[] }
  warnings: string[]; dependencies: string | null; min_staffing: number | null; notes: string | null; sort_order: number
  dependent_assets: { id: number; code: string; name: string; supplier: SupplierBrief | null }[]
  dependent_suppliers: SupplierBrief[]
}

interface BiaDetail extends BiaSummary {
  items: BiaItem[]
  available_services: { id: number; code: string; name: string; criticality: number }[]
  documents: DocLink[]
}

const FALLBACK_DIMENSIONS: Record<string, string> = {
  operational: "Operational", financial: "Financial", legal: "Legal / regulatory", safety: "Health and safety", reputation: "Reputation",
}
const FALLBACK_WINDOWS = [{ key: "4h", label: "4 hours", hours: 4 }, { key: "24h", label: "24 hours", hours: 24 },
  { key: "72h", label: "72 hours", hours: 72 }, { key: "1w", label: "1 week", hours: 168 }]
const SHORT_WINDOW: Record<string, string> = { "4h": "4 h", "24h": "24 h", "72h": "72 h", "1w": "1 w" }
const LEVELS: Record<number, string> = { 0: "None", 1: "Minor", 2: "Moderate", 3: "Serious", 4: "Critical" }
const LEVEL_CLASS = ["bg-muted text-ink-3", "bg-sage-50 text-sage", "bg-amber-50 text-amber", "bg-alarm-50 text-alarm", "bg-alarm text-white"]

const biaKey = (id: number) => ["inv", "bia", id] as const

// --- list -----------------------------------------------------------------------------------------------

export function BiaTab({ biaId }: { biaId: number | null }) {
  if (biaId != null) return <BiaEditor id={biaId} />
  return <BiaList />
}

function BiaList() {
  const { canAny } = useAuth()
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ["inv", "bias"], queryFn: () => api.get<BiaSummary[]>("/inventory/bias") })
  const [creating, setCreating] = useState(false)
  const canCreate = canAny("assets.manage")
  const rows = q.data ?? []
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[80ch] text-[13px] text-ink-2">
          A business impact analysis per entity rates the impact of an outage of each service or process over time. The first time window with a
          serious impact sets the maximum tolerable period of disruption (MTPD); approval adopts the RTO and RPO as service targets (IR 2024/2690 point 4.1.3).
        </p>
        {canCreate && <Button onClick={() => setCreating(true)}><Plus /> New BIA</Button>}
      </div>
      <div className="rounded-md border bg-card">
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} className="m-4" /> : rows.length === 0 ? (
          <Empty title="No business impact analysis yet" icon={<ClipboardCheck className="size-6" />}
            action={canCreate && <Button size="sm" onClick={() => setCreating(true)}><Plus /> New BIA</Button>}>
            Start a BIA for an entity. Its services are added automatically so you can rate their impacts.
          </Empty>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-[12px] text-ink-3">
                <th className="py-2 pr-2 pl-4 font-medium">BIA</th>
                <th className="px-2 py-2 font-medium">Entity</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 text-right font-medium">Items</th>
                <th className="px-2 py-2 font-medium">Warnings</th>
                <th className="px-2 py-2 font-medium">Approved</th>
                <th className="px-2 py-2 pr-4 font-medium">Next review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/50" onClick={() => navigate(`/inventory/bia/${b.id}`)}>
                  <td className="py-2 pr-2 pl-4">
                    <Link to={`/inventory/bia/${b.id}`} className="font-medium text-ink hover:text-petrol" onClick={(e) => e.stopPropagation()}>{b.title || `BIA ${b.period}`}</Link>
                    <div className="text-[12px] text-ink-3">Period {b.period}</div>
                  </td>
                  <td className="px-2 py-2">{b.entity && <EntityTag code={b.entity.code} name={b.entity.name} />}</td>
                  <td className="px-2 py-2"><BiaStatus status={b.status} /></td>
                  <td className="tabular px-2 py-2 text-right">{b.item_count}</td>
                  <td className="px-2 py-2">{b.items_with_warnings ? <span className="text-amber">{b.items_with_warnings} items</span> : <span className="text-ink-3">None</span>}</td>
                  <td className="px-2 py-2 text-ink-2">{b.approved_at ? <>{fmtDate(b.approved_at)} <span className="text-ink-3">by {b.approved_by}</span></> : <span className="text-ink-3">–</span>}</td>
                  <td className="tabular px-2 py-2 pr-4 text-ink-2">{b.next_review ? fmtDate(b.next_review) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <NewBiaDialog open={creating} onOpenChange={setCreating} existing={rows} onCreated={(b) => navigate(`/inventory/bia/${b.id}`)} />
    </div>
  )
}

function BiaStatus({ status }: { status: string }) {
  return status === "approved" ? <Pill tone="sage">Approved</Pill> : <Pill tone="brass">Draft</Pill>
}

function NewBiaDialog({ open, onOpenChange, existing, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; existing: BiaSummary[]; onCreated: (b: BiaDetail) => void
}) {
  const { can } = useAuth()
  const entities = useEntities()
  const qc = useQueryClient()
  const [entityId, setEntityId] = useState<number | null>(null)
  const [period, setPeriod] = useState(String(new Date().getFullYear()))
  const [title, setTitle] = useState("")
  const [copyFrom, setCopyFrom] = useState<string | null>(null)
  const [include, setInclude] = useState(true)
  useEffect(() => { if (open) { setEntityId(null); setTitle(""); setCopyFrom(null); setInclude(true); setPeriod(String(new Date().getFullYear())) } }, [open])
  const create = useMutation({
    mutationFn: () => api.post<BiaDetail>("/inventory/bias", {
      entity_id: entityId, period: period.trim(), title: title.trim() || null,
      copy_from_id: copyFrom ? Number(copyFrom) : null, include_services: include,
    }),
    onSuccess: (b) => { toast.success("BIA created"); qc.invalidateQueries({ queryKey: ["inv"] }); onOpenChange(false); onCreated(b) },
    onError: (e: Error) => toast.error(e.message),
  })
  const managed = (entities.data ?? []).filter((e) => can("assets.manage", e.id))
  const sources = existing.filter((b) => b.entity_id === entityId)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New business impact analysis</DialogTitle>
          <DialogDescription>One BIA per entity and period. Review it at least annually.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Entity">
            <OptionSelect value={entityId != null ? String(entityId) : null} onChange={(v) => { setEntityId(v ? Number(v) : null); setCopyFrom(null) }}
              placeholder="Choose an entity" options={managed.map((e) => ({ value: String(e.id), label: <span><span className="font-mono text-[12px] text-ink-3">{e.code}</span> {e.name}</span> }))} />
          </Field>
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <Field label="Period" htmlFor="bia-period"><Input id="bia-period" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
            <Field label="Title" htmlFor="bia-title"><Input id="bia-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" /></Field>
          </div>
          {sources.length > 0 && (
            <Field label="Start from" hint="Copies all items and impact ratings of the earlier BIA.">
              <OptionSelect value={copyFrom} onChange={setCopyFrom} allowNone noneLabel="Start empty" placeholder="Start empty"
                options={sources.map((b) => ({ value: String(b.id), label: `${b.title || "BIA"} (${b.period}, ${b.status})` }))} />
            </Field>
          )}
          {!copyFrom && (
            <div className="flex items-center gap-2">
              <Switch id="bia-include" checked={include} onCheckedChange={setInclude} />
              <Label htmlFor="bia-include" className="text-[13px] font-normal">Add all active services of the entity</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={entityId == null || !period.trim() || create.isPending} onClick={() => create.mutate()}>Create BIA</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- editor ---------------------------------------------------------------------------------------------

function BiaEditor({ id }: { id: number }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const meta = useInventoryMeta()
  const q = useQuery({ queryKey: biaKey(id), queryFn: () => api.get<BiaDetail>(`/inventory/bias/${id}`) })
  const [adding, setAdding] = useState(false)
  const [editingMeta, setEditingMeta] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const onDone = (b: BiaDetail) => { qc.setQueryData(biaKey(id), b); qc.invalidateQueries({ queryKey: ["inv", "bias"] }) }
  const approve = useMutation({
    mutationFn: () => api.post<BiaDetail>(`/inventory/bias/${id}/approve`),
    onSuccess: (b) => { onDone(b); qc.invalidateQueries({ queryKey: ["inv"] }); toast.success("BIA approved; RTO and RPO adopted as service targets") },
    onError: (e: Error) => toast.error(e.message),
  })
  const reopen = useMutation({
    mutationFn: () => api.post<BiaDetail>(`/inventory/bias/${id}/reopen`),
    onSuccess: (b) => { onDone(b); toast.success("BIA reopened as draft") },
    onError: (e: Error) => toast.error(e.message),
  })
  const del = useMutation({
    mutationFn: () => api.del(`/inventory/bias/${id}`),
    onSuccess: () => { toast.success("BIA deleted"); qc.invalidateQueries({ queryKey: ["inv"] }); navigate("/inventory/bia") },
    onError: (e: Error) => toast.error(e.message),
  })

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState error={q.error} />
  const b = q.data!
  const editable = b.can_edit && b.status === "draft"
  const dims = meta.data?.dimensions ?? FALLBACK_DIMENSIONS
  const windows = meta.data?.windows ?? FALLBACK_WINDOWS
  const toggle = (itemId: number) => setExpanded((s) => { const n = new Set(s); if (n.has(itemId)) n.delete(itemId); else n.add(itemId); return n })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/inventory/bia" className="text-[12.5px] text-ink-3 hover:text-petrol">All BIAs</Link>
          <h2 className="mt-1 flex flex-wrap items-center gap-2 text-[17px] font-semibold text-ink">
            {b.title || `BIA ${b.period}`}
            {b.entity && <EntityTag code={b.entity.code} name={b.entity.name} />}
            <BiaStatus status={b.status} />
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            Period {b.period}
            {b.approved_at && <>. Approved {fmtDateTime(b.approved_at)} by {b.approved_by}</>}
            {b.next_review && <>. Next review {fmtDate(b.next_review)}</>}
          </p>
          {b.status === "draft" && b.can_edit && !b.can_approve && (
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              Four-eyes principle: approval by someone other than {[b.created_by, b.updated_by].filter((x, i, a) => x && a.indexOf(x) === i).join(" and ") || "the creator and the last editor"}.
            </p>
          )}
        </div>
        {b.can_edit && (
          <div className="flex flex-wrap gap-2">
            {b.status === "draft" ? (
              <>
                <Button variant="outline" onClick={() => setEditingMeta(true)}><Pencil /> Edit details</Button>
                <Button variant="outline" onClick={() => setAdding(true)}><Plus /> Add service or process</Button>
                <Confirm title="Approve this BIA?" confirmLabel="Approve BIA" destructive={false} onConfirm={() => approve.mutate()}
                  description="The RTO and RPO of every service in this BIA become the service's recovery targets. Items can only be changed after reopening."
                  trigger={<Button disabled={!b.items.length || !b.can_approve || approve.isPending}
                    title={b.can_approve ? undefined : "Four-eyes principle: someone other than the creator and the last editor approves"}>
                    <CheckCircle2 /> Approve</Button>} />
                <Confirm title="Delete this draft BIA?" confirmLabel="Delete BIA" onConfirm={() => del.mutate()}
                  trigger={<Button variant="outline" aria-label="Delete BIA"><Trash2 /></Button>} />
              </>
            ) : (
              <Confirm title="Reopen this BIA?" confirmLabel="Reopen" destructive={false} onConfirm={() => reopen.mutate()}
                description="The BIA returns to draft so items can be changed. Approve it again afterwards."
                trigger={<Button variant="outline"><RotateCcw /> Reopen</Button>} />
            )}
          </div>
        )}
      </div>

      {b.notes && <p className="max-w-[90ch] text-[13px] whitespace-pre-wrap text-ink-2">{b.notes}</p>}

      <Section title="Impact over time" bodyClassName="p-0">
        {b.items.length === 0 ? (
          <Empty title="No services or processes yet" action={editable && <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add service or process</Button>}>
            Add the services and processes of the entity and rate the impact of an outage per time window.
          </Empty>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="text-[12px] text-ink-3">
                  <th rowSpan={2} className="sticky left-0 z-10 min-w-[240px] border-b bg-card py-2 pr-2 pl-4 text-left font-medium">Service or process</th>
                  {Object.entries(dims).map(([k, label]) => (
                    <th key={k} colSpan={windows.length} className="border-b border-l px-1 pt-2 pb-1 text-center font-medium">{label}</th>
                  ))}
                  <th rowSpan={2} className="border-b border-l px-2 py-2 text-right font-medium">MTPD</th>
                  <th rowSpan={2} className="border-b px-2 py-2 text-right font-medium">RTO</th>
                  <th rowSpan={2} className="border-b px-2 py-2 text-right font-medium">RPO</th>
                  <th rowSpan={2} className="border-b px-2 py-2 pr-4 text-right font-medium">Staff</th>
                </tr>
                <tr className="text-[11px] text-ink-3">
                  {Object.keys(dims).map((k) => windows.map((w, i) => (
                    <th key={`${k}-${w.key}`} className={cn("border-b px-0.5 pb-1.5 text-center font-normal", i === 0 && "border-l")}>{SHORT_WINDOW[w.key] ?? w.key}</th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {b.items.map((item) => (
                  <ItemRow key={item.id} item={item} dims={Object.keys(dims)} windows={windows.map((w) => w.key)}
                    editable={editable} expanded={expanded.has(item.id)} onToggle={() => toggle(item.id)} onSaved={onDone} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t px-4 py-2 text-[12px] text-ink-3">
          <span className="flex items-center gap-1">Impact
            {[0, 1, 2, 3, 4].map((l) => <span key={l} className={cn("tabular inline-flex size-5 items-center justify-center rounded-[3px] text-[11px] font-medium", LEVEL_CLASS[l])} title={LEVELS[l]}>{l}</span>)}
            none to critical
          </span>
          <span>MTPD = first window with a serious (3) or critical (4) impact. RTO defaults to half the MTPD, RPO to the RTO (at most 24 h); manual values win.</span>
          {editable && <span>Click a cell to raise the level; use the arrow keys or Delete on a focused cell.</span>}
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Documents">
          <DocumentLinks targetType="bia" targetId={b.id} documents={b.documents} entityId={b.entity_id} canEdit={b.can_edit}
            onChange={() => qc.invalidateQueries({ queryKey: biaKey(id) })} />
        </Section>
        <Section title="Comments"><CommentsPanel targetType="bia" targetId={b.id} canComment={b.can_edit} /></Section>
      </div>

      <AddItemDialog open={adding} onOpenChange={setAdding} bia={b} onSaved={onDone} />
      <BiaMetaDialog open={editingMeta} onOpenChange={setEditingMeta} bia={b} onSaved={onDone} />
    </div>
  )
}

interface Draft {
  impacts: Impacts; mtpd: string; rto: string; rpo: string; staff: string; dependencies: string; notes: string
}

const toDraft = (i: BiaItem): Draft => ({
  impacts: i.impacts ?? {}, mtpd: i.mtpd_hours_manual?.toString() ?? "", rto: i.rto_hours_manual?.toString() ?? "",
  rpo: i.rpo_hours_manual?.toString() ?? "", staff: i.min_staffing?.toString() ?? "", dependencies: i.dependencies ?? "", notes: i.notes ?? "",
})

function ItemRow({ item, dims, windows, editable, expanded, onToggle, onSaved }: {
  item: BiaItem; dims: string[]; windows: string[]; editable: boolean; expanded: boolean
  onToggle: () => void; onSaved: (b: BiaDetail) => void
}) {
  const openSheet = useOpenSheet()
  const [draft, setDraft] = useState<Draft>(() => toDraft(item))
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { if (!dirty.current) setDraft(toDraft(item)) }, [item])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const staff = d.staff.trim() ? Math.max(0, Math.round(Number(d.staff))) : null
      return api.put<BiaDetail>(`/inventory/bia-items/${item.id}`, {
        service_id: item.service_id, process_name: item.process_name, impacts: d.impacts,
        mtpd_hours: numOrNull(d.mtpd), rto_hours: numOrNull(d.rto), rpo_hours: numOrNull(d.rpo),
        min_staffing: Number.isFinite(staff) ? staff : null, dependencies: d.dependencies.trim() || null, notes: d.notes.trim() || null,
      })
    },
    onSuccess: (b) => { dirty.current = false; onSaved(b) },
    onError: (e: Error) => toast.error(`Could not save ${item.label}: ${e.message}`),
  })
  const del = useMutation({
    mutationFn: () => api.del<BiaDetail>(`/inventory/bia-items/${item.id}`),
    onSuccess: (b) => { toast.success("Item removed"); onSaved(b) },
    onError: (e: Error) => toast.error(e.message),
  })

  const update = (d: Draft, immediate = false) => {
    dirty.current = true
    setDraft(d)
    if (timer.current) clearTimeout(timer.current)
    if (immediate) save.mutate(d)
    else timer.current = setTimeout(() => save.mutate(d), 700)
  }
  const flush = () => { if (dirty.current) { if (timer.current) clearTimeout(timer.current); save.mutate(draft) } }
  const setLevel = (dim: string, w: string, v: number | null) => {
    const row = { ...(draft.impacts[dim] ?? {}) }
    if (v == null) delete row[w]
    else row[w] = v
    update({ ...draft, impacts: { ...draft.impacts, [dim]: row } })
  }
  const derivedMtpd = item.derived.mtpd_hours
  const span = 1 + dims.length * windows.length + 4

  return (
    <Fragment>
      <tr className="group">
        <td className="sticky left-0 z-10 border-b bg-card py-1.5 pr-2 pl-2 align-top">
          <div className="flex items-start gap-1">
            <button className="mt-0.5 rounded p-0.5 text-ink-3 hover:bg-muted hover:text-ink" onClick={onToggle}
              aria-label={expanded ? `Collapse ${item.label}` : `Expand ${item.label}`} aria-expanded={expanded}>
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
            <div className="min-w-0">
              {item.service ? (
                <button className="text-left font-medium text-ink hover:text-petrol" onClick={() => openSheet("service", item.service!.id)}>
                  <Code className="mr-1.5">{item.service.code}</Code>{item.service.name}
                </button>
              ) : <span className="font-medium text-ink">{item.label}<span className="ml-1.5 text-[12px] font-normal text-ink-3">process</span></span>}
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                {item.service && <CritPill value={item.service.criticality} />}
                {item.warnings.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[12px] text-amber" title={item.warnings.join("; ")}>
                    <AlertTriangle className="size-3.5" />{item.warnings.length === 1 ? item.warnings[0] : `${item.warnings.length} warnings`}
                  </span>
                )}
                {save.isPending && <span className="text-[11.5px] text-ink-3">Saving…</span>}
              </div>
            </div>
          </div>
        </td>
        {dims.map((dim) => windows.map((w, i) => (
          <td key={`${dim}-${w}`} className={cn("border-b px-0.5 py-1.5 text-center align-top", i === 0 && "border-l")}>
            <ImpactCell value={draft.impacts[dim]?.[w] ?? null} editable={editable} label={`${dim} impact after ${w} for ${item.label}`}
              onChange={(v) => setLevel(dim, w, v)} />
          </td>
        )))}
        <td className="tabular border-b border-l px-2 py-1.5 text-right align-top">
          <HoursCell value={item.mtpd_hours} manual={item.mtpd_hours_manual != null} emptyLabel="> 1 w" />
        </td>
        <td className="tabular border-b px-2 py-1.5 text-right align-top"><HoursCell value={item.rto_hours} manual={item.rto_hours_manual != null} /></td>
        <td className="tabular border-b px-2 py-1.5 text-right align-top"><HoursCell value={item.rpo_hours} manual={item.rpo_hours_manual != null} /></td>
        <td className="tabular border-b px-2 py-1.5 pr-4 text-right align-top">{item.min_staffing ?? <span className="text-ink-3">–</span>}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={span} className="border-b bg-surface px-4 py-3">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3">
                  <Field label="MTPD (h)" hint={`Derived: ${derivedMtpd == null ? "more than 1 week" : fmtHours(derivedMtpd)}`}>
                    <Input inputMode="decimal" value={draft.mtpd} disabled={!editable} placeholder="Derived"
                      onChange={(e) => { dirty.current = true; setDraft({ ...draft, mtpd: e.target.value }) }} onBlur={flush} />
                  </Field>
                  <Field label="RTO (h)" hint={`Derived: ${fmtHours(item.derived.rto_hours)}`}>
                    <Input inputMode="decimal" value={draft.rto} disabled={!editable} placeholder="Derived"
                      onChange={(e) => { dirty.current = true; setDraft({ ...draft, rto: e.target.value }) }} onBlur={flush} />
                  </Field>
                  <Field label="RPO (h)" hint={`Derived: ${fmtHours(item.derived.rpo_hours)}`}>
                    <Input inputMode="decimal" value={draft.rpo} disabled={!editable} placeholder="Derived"
                      onChange={(e) => { dirty.current = true; setDraft({ ...draft, rpo: e.target.value }) }} onBlur={flush} />
                  </Field>
                  <Field label="Minimum staff">
                    <Input inputMode="numeric" value={draft.staff} disabled={!editable}
                      onChange={(e) => { dirty.current = true; setDraft({ ...draft, staff: e.target.value }) }} onBlur={flush} />
                  </Field>
                </div>
                {item.service && (
                  <p className="text-[12px] text-ink-3">
                    Current service targets: RTO {fmtHours(item.service.rto_hours)}, RPO {fmtHours(item.service.rpo_hours)}. Suggested criticality from the impacts: {item.derived.criticality}.
                  </p>
                )}
                <Field label="Other dependencies" hint="People, external services, manual workarounds">
                  <Textarea rows={2} value={draft.dependencies} disabled={!editable}
                    onChange={(e) => { dirty.current = true; setDraft({ ...draft, dependencies: e.target.value }) }} onBlur={flush} />
                </Field>
                <Field label="Notes">
                  <Textarea rows={2} value={draft.notes} disabled={!editable}
                    onChange={(e) => { dirty.current = true; setDraft({ ...draft, notes: e.target.value }) }} onBlur={flush} />
                </Field>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-[12.5px] font-medium text-ink-2">Supporting assets</div>
                  {item.dependent_assets.length === 0 ? <p className="text-[12.5px] text-ink-3">{item.service ? "No assets linked to this service." : "Processes have no linked assets; describe dependencies in the text field."}</p> : (
                    <ul className="flex flex-wrap gap-1.5">
                      {item.dependent_assets.map((a) => (
                        <li key={a.id}>
                          <button className="inline-flex items-center gap-1.5 rounded-[4px] border bg-card px-2 py-0.5 text-[12.5px] hover:bg-muted" onClick={() => openSheet("asset", a.id)}>
                            <Code className="text-[11.5px]">{a.code}</Code>{a.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-[12.5px] font-medium text-ink-2">Suppliers</div>
                  {item.dependent_suppliers.length === 0 ? <p className="text-[12.5px] text-ink-3">No supplier dependencies.</p> : (
                    <ul className="flex flex-wrap gap-1.5">
                      {item.dependent_suppliers.map((s) => (
                        <li key={s.id}><Link to={`/suppliers/${s.id}`} className="inline-flex rounded-[4px] border bg-card px-2 py-0.5 text-[12.5px] text-ink hover:text-petrol">{s.name}</Link></li>
                      ))}
                    </ul>
                  )}
                </div>
                {item.warnings.length > 0 && (
                  <ul className="space-y-1 text-[12.5px] text-amber">
                    {item.warnings.map((w) => <li key={w} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{w}</li>)}
                  </ul>
                )}
                {editable && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" disabled={save.isPending} onClick={() => update(draft, true)}>Save changes</Button>
                    <Confirm title={`Remove ${item.label} from this BIA?`} confirmLabel="Remove" onConfirm={() => del.mutate()}
                      trigger={<Button size="sm" variant="outline"><Trash2 /> Remove from BIA</Button>} />
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function HoursCell({ value, manual, emptyLabel = "–" }: { value: number | null; manual: boolean; emptyLabel?: string }) {
  if (value == null) return <span className="text-ink-3">{emptyLabel}</span>
  return <span className={cn(manual ? "font-medium text-ink" : "text-ink-2")} title={manual ? "Entered manually" : "Derived from the impacts"}>{fmtHours(value)}</span>
}

function ImpactCell({ value, editable, label, onChange }: { value: number | null; editable: boolean; label: string; onChange: (v: number | null) => void }) {
  const cls = cn("tabular inline-flex h-7 w-7 items-center justify-center rounded-[3px] text-[12px] font-medium",
    value == null ? "border border-dashed text-ink-3" : LEVEL_CLASS[value])
  const text = value == null ? "–" : String(value)
  const title = value == null ? "Not rated" : `${value} ${LEVELS[value]}`
  if (!editable) return <span className={cls} title={title}>{text}</span>
  return (
    <button type="button" className={cn(cls, "outline-none hover:ring-1 hover:ring-ink-3 focus-visible:ring-2 focus-visible:ring-petrol")}
      title={`${title}. Click to raise`} aria-label={`${label}: ${title}`}
      onClick={() => onChange(value == null ? 0 : value >= 4 ? null : value + 1)}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); onChange(value == null ? 0 : Math.min(4, value + 1)) }
        else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); onChange(value == null || value === 0 ? null : value - 1) }
        else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onChange(null) }
        else if (/^[0-4]$/.test(e.key)) { e.preventDefault(); onChange(Number(e.key)) }
      }}>
      {text}
    </button>
  )
}

function AddItemDialog({ open, onOpenChange, bia, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; bia: BiaDetail; onSaved: (b: BiaDetail) => void }) {
  const [serviceId, setServiceId] = useState<number | null>(null)
  const [process, setProcess] = useState("")
  useEffect(() => { if (open) { setServiceId(null); setProcess("") } }, [open])
  const add = useMutation({
    mutationFn: () => api.post<BiaDetail>(`/inventory/bias/${bia.id}/items`, serviceId != null
      ? { service_id: serviceId, impacts: {} } : { process_name: process.trim(), impacts: {} }),
    onSuccess: (b) => { toast.success("Added to the BIA"); onSaved(b); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add service or process</DialogTitle>
          <DialogDescription>Choose a service of the entity or a group-wide service, or name a process that has no service record.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Service">
            <Combo value={serviceId} onChange={(v) => { setServiceId(v); if (v != null) setProcess("") }} placeholder="Choose a service"
              items={bia.available_services.map((s) => ({ value: s.id, label: `${s.code} ${s.name}`, hint: ["", "Low", "Medium", "High", "Critical"][s.criticality] }))} />
          </Field>
          <Field label="Or process name" htmlFor="bia-process">
            <Input id="bia-process" value={process} onChange={(e) => { setProcess(e.target.value); if (e.target.value) setServiceId(null) }} placeholder="e.g. Quality release of finished goods" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={(serviceId == null && !process.trim()) || add.isPending} onClick={() => add.mutate()}>Add to BIA</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BiaMetaDialog({ open, onOpenChange, bia, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; bia: BiaDetail; onSaved: (b: BiaDetail) => void }) {
  const [period, setPeriod] = useState(bia.period)
  const [title, setTitle] = useState(bia.title ?? "")
  const [notes, setNotes] = useState(bia.notes ?? "")
  const [review, setReview] = useState(bia.next_review ?? "")
  useEffect(() => { if (open) { setPeriod(bia.period); setTitle(bia.title ?? ""); setNotes(bia.notes ?? ""); setReview(bia.next_review ?? "") } }, [open, bia])
  const save = useMutation({
    mutationFn: () => api.put<BiaDetail>(`/inventory/bias/${bia.id}`, { period: period.trim(), title: title.trim() || null, notes: notes.trim() || null, next_review: review || null }),
    onSuccess: (b) => { toast.success("BIA saved"); onSaved(b); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit BIA details</DialogTitle><DialogDescription>Period, title, notes and the next review date.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <Field label="Period" htmlFor="bm-period"><Input id="bm-period" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
            <Field label="Title" htmlFor="bm-title"><Input id="bm-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          </div>
          <Field label="Next review" htmlFor="bm-review"><Input id="bm-review" type="date" value={review} onChange={(e) => setReview(e.target.value)} /></Field>
          <Field label="Notes" htmlFor="bm-notes"><Textarea id="bm-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!period.trim() || save.isPending} onClick={() => save.mutate()}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
