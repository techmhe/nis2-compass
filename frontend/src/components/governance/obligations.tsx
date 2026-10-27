import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarCheck, CheckCircle2, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, EntityTag, ErrorState, Loading, Pill, Section } from "@/components/common/basics"
import { CommentsPanel, Confirm } from "@/components/common/collab"
import { EntitySelect, Field, OptionSelect, StakeholderSelect, UserSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate, isoDate, toDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { DueBadge, DueDate, EntityFilter, govKeys, Meta, relDue } from "./shared"
import { KIND_LABEL, OBLIGATION_KINDS, RECURRENCE, RECURRENCE_LABEL, type Obligation, type RegistrationChange } from "./types"

type StatusFilter = "open" | "done" | "all"

function useObligations() {
  return useQuery({ queryKey: govKeys.obligations, queryFn: () => api.get<Obligation[]>("/governance/obligations") })
}

export function invalidateGov(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: govKeys.all })
}

/* ---------- create / edit ---------- */

interface Form {
  entity_id: number | null
  kind: string
  title: string
  description: string
  legal_ref: string
  due_date: string
  recurrence: string
  owner_stakeholder_id: number | null
  owner_user_id: number | null
}

const emptyForm = (entityId: number | null): Form => ({
  entity_id: entityId, kind: "other", title: "", description: "", legal_ref: "", due_date: "", recurrence: "none",
  owner_stakeholder_id: null, owner_user_id: null,
})

const toForm = (o: Obligation): Form => ({
  entity_id: o.entity_id, kind: o.kind, title: o.title, description: o.description ?? "", legal_ref: o.legal_ref ?? "",
  due_date: o.due_date, recurrence: o.recurrence, owner_stakeholder_id: o.owner_stakeholder_id, owner_user_id: o.owner_user_id,
})

export function ObligationDialog({ open, onOpenChange, obligation, defaultEntity = null }: {
  open: boolean; onOpenChange: (o: boolean) => void; obligation?: Obligation | null; defaultEntity?: number | null
}) {
  const qc = useQueryClient()
  const { can, canGlobal } = useAuth()
  const [f, setF] = useState<Form>(emptyForm(defaultEntity))
  useEffect(() => { if (open) setF(obligation ? toForm(obligation) : emptyForm(defaultEntity)) }, [open, obligation, defaultEntity])
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const allowed = f.entity_id == null ? canGlobal("governance.manage") : can("governance.manage", f.entity_id)
  const valid = f.title.trim() && f.due_date && allowed
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, title: f.title.trim(), description: f.description.trim() || null, legal_ref: f.legal_ref.trim() || null }
      return obligation ? api.put<Obligation>(`/governance/obligations/${obligation.id}`, body) : api.post<Obligation>("/governance/obligations", body)
    },
    onSuccess: (o) => { toast.success(obligation ? "Obligation saved" : `Obligation created, due ${fmtDate(o.due_date)}`); invalidateGov(qc); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{obligation ? "Edit obligation" : "New obligation"}</DialogTitle>
          <DialogDescription>Recurring obligations create their next occurrence when completed.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto scroll-thin pr-1">
          <Field label="Title" className="col-span-2" htmlFor="ob-title"><Input id="ob-title" value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="Entity"><EntitySelect value={f.entity_id} onChange={(v) => set("entity_id", v)} groupLabel="Group-wide" /></Field>
          <Field label="Kind"><OptionSelect value={f.kind} onChange={(v) => set("kind", v ?? "other")} options={OBLIGATION_KINDS} /></Field>
          <Field label="Due date" htmlFor="ob-due"><Input id="ob-due" type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} /></Field>
          <Field label="Recurrence"><OptionSelect value={f.recurrence} onChange={(v) => set("recurrence", v ?? "none")} options={RECURRENCE} /></Field>
          <Field label="Legal reference" className="col-span-2" htmlFor="ob-ref"><Input id="ob-ref" value={f.legal_ref} onChange={(e) => set("legal_ref", e.target.value)} placeholder="Cbw Art. 24(1)" className="font-mono text-[12.5px]" /></Field>
          <Field label="Owner (role)"><StakeholderSelect value={f.owner_stakeholder_id} onChange={(v) => set("owner_stakeholder_id", v)} placeholder="Stakeholder…" /></Field>
          <Field label="Owner (person)"><UserSelect value={f.owner_user_id} onChange={(v) => set("owner_user_id", v)} placeholder="User…" /></Field>
          <Field label="Description" className="col-span-2" htmlFor="ob-desc"><Textarea id="ob-desc" rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
        </div>
        {!allowed && <p className="text-[12.5px] text-alarm">You cannot manage obligations for the selected scope.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{obligation ? "Save changes" : "Create obligation"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- complete ---------- */

export function CompleteDialog({ obligation, onOpenChange }: { obligation: Obligation | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [date, setDate] = useState(isoDate(new Date()))
  const [note, setNote] = useState("")
  useEffect(() => { if (obligation) { setDate(isoDate(new Date())); setNote("") } }, [obligation])
  const done = useMutation({
    mutationFn: () => api.post<{ next: Obligation | null }>(`/governance/obligations/${obligation!.id}/complete`, { completed_at: date, note: note.trim() || null }),
    onSuccess: (r) => {
      toast.success(r.next ? `Completed. Next occurrence due ${fmtDate(r.next.due_date)}` : "Obligation completed")
      invalidateGov(qc)
      qc.invalidateQueries({ queryKey: ["my-work"] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={obligation != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Complete obligation</DialogTitle>
          <DialogDescription>{obligation?.title}{obligation && obligation.recurrence !== "none" ? `. The next occurrence (${RECURRENCE_LABEL[obligation.recurrence].toLowerCase()}) is created automatically.` : "."}</DialogDescription>
        </DialogHeader>
        <Field label="Completed on" htmlFor="ob-done"><Input id="ob-done" type="date" value={date} max={isoDate(new Date())} onChange={(e) => setDate(e.target.value)} className="w-44" /></Field>
        <Field label="Note" hint="For example the decision, protocol or evidence that proves completion" htmlFor="ob-note">
          <Textarea id="ob-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!date || done.isPending} onClick={() => done.mutate()}><CheckCircle2 /> Mark as completed</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- detail sheet ---------- */

function ObligationSheet({ obligation, onClose, onEdit, onComplete }: {
  obligation: Obligation | null; onClose: () => void; onEdit: (o: Obligation) => void; onComplete: (o: Obligation) => void
}) {
  const qc = useQueryClient()
  const reopen = useMutation({
    mutationFn: (id: number) => api.post(`/governance/obligations/${id}/reopen`, {}),
    onSuccess: () => { toast.success("Obligation reopened"); invalidateGov(qc) },
    onError: (e: Error) => toast.error(e.message),
  })
  const o = obligation
  return (
    <Sheet open={o != null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[560px]">
        {o && (
          <>
            <SheetHeader className="border-b px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                {o.entity ? <EntityTag code={o.entity.code} name={o.entity.name} /> : <Pill tone="outline">Group</Pill>}
                <Pill tone="outline">{KIND_LABEL[o.kind] ?? o.kind}</Pill>
                <DueBadge state={o.state} />
              </div>
              <SheetTitle className="text-[16px]">{o.title}</SheetTitle>
              <SheetDescription>{o.status === "open" ? `Due ${fmtDate(o.due_date)}, ${relDue(o.due_date)}` : o.status === "done" ? `Completed ${fmtDate(o.completed_at)}` : "Cancelled"}</SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-5 py-4">
              <div className="flex flex-wrap gap-2">
                {o.can_complete && <Button size="sm" onClick={() => onComplete(o)}><CheckCircle2 /> Mark as completed</Button>}
                {o.status === "open" && o.source_type === "board_member" && <p className="text-[12.5px] text-ink-3">Closes automatically when a qualifying training is recorded for this member.</p>}
                {o.can_edit && <Button size="sm" variant="outline" onClick={() => onEdit(o)}><Pencil /> Edit</Button>}
                {o.can_edit && o.status !== "open" && <Button size="sm" variant="outline" disabled={reopen.isPending} onClick={() => reopen.mutate(o.id)}><RotateCcw /> Reopen</Button>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Meta label="Due date">{fmtDate(o.due_date)}</Meta>
                <Meta label="Recurrence">{RECURRENCE_LABEL[o.recurrence] ?? o.recurrence}</Meta>
                <Meta label="Legal reference">{o.legal_ref ? <Code>{o.legal_ref}</Code> : null}</Meta>
                <Meta label="Owner">{[o.owner_user, o.owner_stakeholder].filter(Boolean).join(", ") || null}</Meta>
                {o.status === "done" && <Meta label="Completed by">{o.completed_by ? `${o.completed_by}, ${fmtDate(o.completed_at)}` : fmtDate(o.completed_at)}</Meta>}
                {o.completion_note && <Meta label="Completion note">{o.completion_note}</Meta>}
                <Meta label="Source">{o.source === "board_member" ? <Link className="text-petrol hover:underline" to={`/governance/management?member=${o.source_id}`}>Management body member</Link> : o.source === "seed" ? "Standard obligation" : o.source === "manual" ? "Created manually" : o.source}</Meta>
              </div>
              {o.description && <p className="text-[13px] whitespace-pre-wrap text-ink-2">{o.description}</p>}
              <div>
                <h3 className="mb-2 text-[13px] font-semibold">Comments</h3>
                <CommentsPanel targetType="obligation" targetId={o.id} canComment={o.can_edit} />
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ---------- main view ---------- */

type Item =
  | { type: "obligation"; key: string; due: string; ob: Obligation }
  | { type: "change"; key: string; due: string; ch: RegistrationChange }

const monthKey = (d: string) => d.slice(0, 7)
const monthLabel = (k: string) => toDate(`${k}-01`)!.toLocaleDateString("en-GB", { month: "long", year: "numeric" })

export function ObligationsView() {
  const { canAny } = useAuth()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [entity, setEntity] = useState<number | null>(null)
  const [status, setStatus] = useState<StatusFilter>("open")
  const [kind, setKind] = useState<string | null>(null)
  const [text, setText] = useState("")
  const [month, setMonth] = useState<string | null>(null)
  const [editing, setEditing] = useState<Obligation | null>(null)
  const [creating, setCreating] = useState(false)
  const [completing, setCompleting] = useState<Obligation | null>(null)
  const obs = useObligations()
  const changes = useQuery({ queryKey: govKeys.changes, queryFn: () => api.get<RegistrationChange[]>("/governance/registration-changes") })
  const canManage = canAny("governance.manage")

  const selectedId = Number(params.get("obligation")) || null
  const selected = (obs.data ?? []).find((o) => o.id === selectedId) ?? null
  const setSelected = (id: number | null) => setParams((p) => { if (id) p.set("obligation", String(id)); else p.delete("obligation"); return p }, { replace: true })

  const del = useMutation({
    mutationFn: (id: number) => api.del(`/governance/obligations/${id}`),
    onSuccess: () => { toast.success("Obligation deleted"); invalidateGov(qc) },
    onError: (e: Error) => toast.error(e.message),
  })

  const items = useMemo(() => {
    const q = text.trim().toLowerCase()
    const out: Item[] = []
    for (const o of obs.data ?? []) {
      if (status === "open" && o.status !== "open") continue
      if (status === "done" && o.status === "open") continue
      if (entity != null && o.entity_id !== entity) continue
      if (kind && o.kind !== kind) continue
      if (q && !`${o.title} ${o.legal_ref ?? ""} ${o.entity?.code ?? ""} ${o.owner_stakeholder ?? ""} ${o.owner_user ?? ""}`.toLowerCase().includes(q)) continue
      out.push({ type: "obligation", key: `o${o.id}`, due: status === "done" && o.completed_at ? o.completed_at : o.due_date, ob: o })
    }
    if (status !== "done" && (!kind || kind === "registration_change")) {
      for (const c of changes.data ?? []) {
        if (entity != null && c.entity_id !== entity) continue
        if (q && !`registration change ${c.field_label} ${c.entity_code ?? ""}`.toLowerCase().includes(q)) continue
        out.push({ type: "change", key: `c${c.id}`, due: c.due_at, ch: c })
      }
    }
    out.sort((a, b) => (status === "done" ? b.due.localeCompare(a.due) : a.due.localeCompare(b.due)))
    return out
  }, [obs.data, changes.data, status, entity, kind, text])

  const todayIso = isoDate(new Date())
  const strip = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 12 }, (_, i) => isoDate(new Date(now.getFullYear(), now.getMonth() + i, 1)).slice(0, 7))
    const counts = new Map<string, number>()
    let overdue = 0
    for (const it of items) {
      if (status !== "done" && it.due < todayIso) overdue++
      else counts.set(monthKey(it.due), (counts.get(monthKey(it.due)) ?? 0) + 1)
    }
    return { months, counts, overdue, max: Math.max(1, ...counts.values()) }
  }, [items, status, todayIso])

  const grouped = useMemo(() => {
    const g: { key: string; label: string; items: Item[]; overdue?: boolean }[] = []
    for (const it of items) {
      if (month && (month === "overdue" ? !(it.due < todayIso) : !(monthKey(it.due) === month && it.due >= todayIso))) continue
      const overdue = status !== "done" && it.due < todayIso
      const key = overdue ? "overdue" : monthKey(it.due)
      let grp = g.find((x) => x.key === key)
      if (!grp) { grp = { key, label: overdue ? "Overdue" : monthLabel(key), items: [], overdue }; g.push(grp) }
      grp.items.push(it)
    }
    return g
  }, [items, month, status, todayIso])

  if (obs.isLoading) return <Loading />
  if (obs.error) return <ErrorState error={obs.error} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <EntityFilter value={entity} onChange={setEntity} className="w-60" />
        <OptionSelect className="w-44" value={kind} onChange={setKind} allowNone noneLabel="All kinds" placeholder="All kinds"
          options={[...OBLIGATION_KINDS, { value: "registration_change", label: "Registration change" }]} />
        <div role="radiogroup" aria-label="Status" className="inline-flex rounded-md border bg-surface p-0.5">
          {(["open", "done", "all"] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={status === s} onClick={() => { setStatus(s); setMonth(null) }}
              className={cn("h-7 rounded-[4px] px-2.5 text-[12.5px] font-medium", status === s ? "bg-petrol text-white" : "text-ink-2 hover:bg-muted")}>
              {s === "open" ? "Open" : s === "done" ? "Completed" : "All"}
            </button>
          ))}
        </div>
        <div className="relative w-64">
          <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Title, reference or owner" className="pl-8" aria-label="Search obligations" />
          {text && <button className="absolute top-2.5 right-2.5 text-ink-3 hover:text-ink" onClick={() => setText("")} aria-label="Clear search"><X className="size-4" /></button>}
        </div>
        {canManage && <Button className="ml-auto" onClick={() => setCreating(true)}><Plus /> New obligation</Button>}
      </div>

      {status !== "done" && (
        <div className="grid grid-cols-[repeat(13,minmax(0,1fr))] gap-1 rounded-md border bg-card p-2" aria-label="Obligations per month">
          <button type="button" onClick={() => setMonth(month === "overdue" ? null : "overdue")} aria-pressed={month === "overdue"}
            className={cn("flex flex-col items-center gap-0.5 rounded-[4px] px-1 py-1.5 text-[11.5px]", month === "overdue" ? "bg-alarm-50 ring-1 ring-alarm/40" : "hover:bg-muted")}>
            <span className="text-ink-3">Overdue</span>
            <span className={cn("tabular text-[15px] font-semibold", strip.overdue ? "text-alarm" : "text-ink-3")}>{strip.overdue}</span>
          </button>
          {strip.months.map((m) => {
            const n = strip.counts.get(m) ?? 0
            return (
              <button key={m} type="button" onClick={() => setMonth(month === m ? null : m)} aria-pressed={month === m}
                className={cn("flex flex-col items-center gap-0.5 rounded-[4px] px-1 py-1.5 text-[11.5px]", month === m ? "bg-petrol-50 ring-1 ring-petrol/40" : "hover:bg-muted")}>
                <span className="text-ink-3">{toDate(`${m}-01`)!.toLocaleDateString("en-GB", { month: "short" })}</span>
                <span className="tabular text-[15px] font-semibold text-ink">{n || "–"}</span>
                <span className="h-1 w-full rounded-full bg-muted"><span className="block h-full rounded-full bg-petrol" style={{ width: `${(n / strip.max) * 100}%` }} /></span>
              </button>
            )
          })}
        </div>
      )}

      {grouped.length === 0 ? (
        <Section><Empty icon={<CalendarCheck className="size-6" />} title={status === "done" ? "No completed obligations" : "No open obligations match"}
          action={(entity || kind || text || month) ? <Button size="sm" variant="outline" onClick={() => { setEntity(null); setKind(null); setText(""); setMonth(null) }}>Clear filters</Button> : undefined}>
          {status === "done" ? "Completed obligations appear here with their completion date." : "Change the filters, or create an obligation for a recurring governance duty."}
        </Empty></Section>
      ) : grouped.map((g) => (
        <Section key={g.key} title={<span className={cn(g.overdue && "text-alarm")}>{g.label} <span className="tabular font-normal text-ink-3">({g.items.length})</span></span>} bodyClassName="p-0">
          <ul>
            {g.items.map((it) => it.type === "obligation" ? (
              <li key={it.key} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-2 last:border-0 md:grid-cols-[110px_minmax(0,1fr)_170px_140px_auto]">
                {it.ob.status === "done" ? <span className="tabular text-[12.5px] text-ink-3">{fmtDate(it.ob.completed_at)}</span> : <DueDate date={it.ob.due_date} />}
                <button className="min-w-0 text-left" onClick={() => setSelected(it.ob.id)}>
                  <div className="flex items-center gap-2">
                    {it.ob.entity ? <EntityTag code={it.ob.entity.code} name={it.ob.entity.name} /> : <Pill tone="outline">Group</Pill>}
                    <span className="truncate text-[13px] font-medium text-ink hover:text-petrol">{it.ob.title}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-ink-3">
                    <span>{KIND_LABEL[it.ob.kind] ?? it.ob.kind}</span>
                    {it.ob.recurrence !== "none" && <span>{RECURRENCE_LABEL[it.ob.recurrence]}</span>}
                    {it.ob.legal_ref && <Code className="text-[11.5px] text-ink-3">{it.ob.legal_ref}</Code>}
                  </div>
                </button>
                <span className="hidden truncate text-[12.5px] text-ink-2 md:block">{it.ob.owner_user ?? it.ob.owner_stakeholder ?? <span className="text-ink-3">No owner</span>}</span>
                <span className="hidden md:block"><DueBadge state={it.ob.state} /></span>
                <span className="flex items-center justify-end gap-1">
                  {it.ob.can_complete && <Button size="xs" variant="outline" onClick={() => setCompleting(it.ob)}><CheckCircle2 /> Complete</Button>}
                  {it.ob.can_edit && <Button size="icon-xs" variant="ghost" aria-label={`Edit ${it.ob.title}`} onClick={() => setEditing(it.ob)}><Pencil /></Button>}
                  {it.ob.can_edit && (
                    <Confirm title="Delete this obligation?" description="Completed occurrences stay in the history; only this entry is removed."
                      onConfirm={() => del.mutateAsync(it.ob.id)}
                      trigger={<Button size="icon-xs" variant="ghost" aria-label={`Delete ${it.ob.title}`}><Trash2 /></Button>} />
                  )}
                </span>
              </li>
            ) : (
              <li key={it.key} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-2 last:border-0 md:grid-cols-[110px_minmax(0,1fr)_170px_140px_auto]">
                <DueDate date={it.ch.due_at} />
                <Link to={`/governance/registrations?registration=${it.ch.registration_id}`} className="min-w-0">
                  <div className="flex items-center gap-2">
                    {it.ch.entity_code && <EntityTag code={it.ch.entity_code} />}
                    <span className="truncate text-[13px] font-medium text-ink hover:text-petrol">Report registration change: {it.ch.field_label}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-3">Registration change <Code className="text-[11.5px] text-ink-3">{it.ch.jurisdiction === "NL" ? "Cbw Art. 44(2)" : "§ 33(5) BSIG"}</Code></div>
                </Link>
                <span className="hidden text-[12.5px] text-ink-3 md:block">Governance managers</span>
                <span className="hidden md:block"><DueBadge state={it.ch.state} /></span>
                <span />
              </li>
            ))}
          </ul>
        </Section>
      ))}

      <ObligationDialog open={creating || editing != null} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null) } }} obligation={editing} defaultEntity={entity} />
      <CompleteDialog obligation={completing} onOpenChange={(o) => !o && setCompleting(null)} />
      <ObligationSheet obligation={selected} onClose={() => setSelected(null)} onEdit={(o) => setEditing(o)} onComplete={(o) => setCompleting(o)} />
    </div>
  )
}
