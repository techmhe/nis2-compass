import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { AlertTriangle, Check, MoreHorizontal, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Code, EntityTag, ErrorState, Pill } from "@/components/common/basics"
import { Confirm } from "@/components/common/collab"
import { Field, OptionSelect } from "@/components/common/fields"
import { api } from "@/lib/api"
import { toDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { type Regime, REGIME_LABEL, type ReportingOverview, type Stage, type Track } from "./reporting-types"
import { duration, fmtDue, fromLocalInput, toLocalInput, useNow } from "./shared"
import { ReportDraftDialog } from "./report-draft"
import { Cite } from "./wizard"

type OnChanged = (o: ReportingOverview) => void

function useTrackMutation(onChanged: OnChanged) {
  return useMutation({
    mutationFn: ({ method, path, body }: { method: "put" | "patch" | "del"; path: string; body?: unknown; msg: string }) =>
      method === "del" ? api.del<ReportingOverview>(path) : api[method]<ReportingOverview>(path, body),
    onSuccess: (o, v) => { toast.success(v.msg); if (o && typeof o === "object" && "tracks" in o) onChanged(o) },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Per-entity, per-authority reporting tracks with their stage timeline. */
export function TrackCards({ data, onChanged, onReload }: { data: ReportingOverview; onChanged: OnChanged; onReload: () => void }) {
  const [adding, setAdding] = useState(false)
  const active = data.tracks.filter((t) => t.status === "active")
  const withdrawn = data.tracks.filter((t) => t.status !== "active")
  return (
    <div className="space-y-3">
      {[...active, ...withdrawn].map((t) => <TrackCard key={t.id} t={t} canEdit={data.can_edit} onChanged={onChanged} onReload={onReload} />)}
      {data.can_edit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus /> Add reporting track</Button>
          {data.profile.personal_data_breach && !data.tracks.some((t) => t.regime === "gdpr") && (
            <span className="text-[12.5px] text-amber">Personal data are affected: add a GDPR track (notification to the data protection authority within 72 hours).</span>
          )}
          {data.profile.product_affected && !data.tracks.some((t) => t.regime === "cra") && (
            <span className="text-[12.5px] text-amber">A product with digital elements is affected: check the CRA reporting duty (ENISA Single Reporting Platform, 24 hours).</span>
          )}
        </div>
      )}
      {adding && <AddTrackDialog data={data} onClose={() => setAdding(false)} onSaved={(o) => { setAdding(false); onChanged(o) }} />}
    </div>
  )
}

function TrackCard({ t, canEdit, onChanged, onReload }: { t: Track; canEdit: boolean; onChanged: OnChanged; onReload: () => void }) {
  const now = useNow(30_000)
  const [editing, setEditing] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const m = useTrackMutation(onChanged)
  const del = useMutation({
    mutationFn: () => api.del(`/incident-reporting/tracks/${t.id}`),
    onSuccess: () => { toast.success("Track deleted"); onReload() },
    onError: (e: Error) => toast.error(e.message),
  })
  const withdrawn = t.status === "withdrawn"
  const anySubmitted = t.stages.some((s) => s.submitted_at)
  return (
    <div className={cn("rounded-md border", withdrawn ? "bg-muted/40 opacity-80" : "bg-card")}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <EntityTag code={t.entity.code} name={t.entity.name} />
        <Pill tone={t.regime === "nis2" ? "petrol" : "brass"}>{REGIME_LABEL[t.regime]}{t.regime === "nis2" && t.jurisdiction ? ` ${t.jurisdiction}` : ""}</Pill>
        <span className="text-[13px] font-medium text-ink">{t.authority}</span>
        {t.reference && <Code className="text-ink-3">{t.reference}</Code>}
        {withdrawn && <Pill tone="outline">Withdrawn</Pill>}
        {t.complete && !withdrawn && <Pill tone="petrol">All reports submitted</Pill>}
        <span className="flex-1" />
        {t.effective_aware_at && <span className="text-[12px] text-ink-3">Aware since <span className="tabular">{fmtDue(t.effective_aware_at)}</span></span>}
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Track actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!withdrawn && <DropdownMenuItem onSelect={() => setEditing(true)}>Edit authority and reference</DropdownMenuItem>}
              {t.regime === "nis2" && !withdrawn && !t.stages.some((s) => s.stage === "intermediate") && (
                <DropdownMenuItem onSelect={() => setRequesting(true)}>Record request for an intermediate report</DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => m.mutate({ method: "patch", path: `/incident-reporting/tracks/${t.id}`, body: { status: withdrawn ? "active" : "withdrawn" },
                msg: withdrawn ? "Track reopened" : "Track withdrawn" })}>
                {withdrawn ? "Reopen track" : "Withdraw track (no reporting duty)"}
              </DropdownMenuItem>
              {!anySubmitted && <DropdownMenuItem className="text-alarm" onSelect={() => del.mutate()}>Delete track</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {!t.effective_aware_at ? (
        <p className="px-3 py-2.5 text-[13px] text-amber">The time of becoming aware is missing, so the deadlines cannot be computed. Enter it in the incident below.</p>
      ) : (
        <ol className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
          {t.stages.map((s, i) => <StageCard key={s.stage} t={t} s={s} idx={i} now={now} canEdit={canEdit && !withdrawn} onChanged={onChanged} />)}
        </ol>
      )}
      {t.notes && <p className="border-t px-3 py-2 text-[12.5px] whitespace-pre-line text-ink-2">{t.notes}</p>}
      {editing && <EditTrackDialog t={t} onClose={() => setEditing(false)} onSaved={(o) => { setEditing(false); onChanged(o) }} />}
      {requesting && <RequestDialog t={t} onClose={() => setRequesting(false)} onSaved={(o) => { setRequesting(false); onChanged(o) }} />}
    </div>
  )
}

function StageCard({ t, s, idx, now, canEdit, onChanged }: { t: Track; s: Stage; idx: number; now: number; canEdit: boolean; onChanged: OnChanged }) {
  const [submitting, setSubmitting] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const m = useTrackMutation(onChanged)
  const path = `/incident-reporting/tracks/${t.id}/stages/${s.stage}`
  const due = toDate(s.due_at)?.getTime() ?? null
  const done = toDate(s.submitted_at)?.getTime() ?? null
  const state = s.state
  const tone = state === "submitted" ? "border-petrol/40 bg-petrol-50/40" : state === "overdue" ? "border-alarm/50 bg-alarm-50/50"
    : state === "due_soon" ? "border-amber/50 bg-amber-50/40" : state === "not_required" ? "border-dashed" : "bg-card"
  const toggle = (key: string, v: boolean) => {
    const checklist = Object.fromEntries(s.checklist.map((c) => [c.key, c.key === key ? v : c.done]))
    m.mutate({ method: "put", path, body: { checklist }, msg: "Checklist updated" })
  }
  return (
    <li className={cn("rounded-md border px-3 py-2.5", tone)}>
      <div className="flex items-center gap-2">
        <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
          state === "submitted" ? "bg-petrol text-white" : state === "overdue" ? "bg-alarm text-white" : "border border-ink-3/60 text-ink-2")}>
          {state === "submitted" ? <Check className="size-3.5" /> : state === "overdue" ? <AlertTriangle className="size-3.5" /> : idx + 1}
        </span>
        <span className="text-[13.5px] font-semibold text-ink">{s.label}</span>
        <span className="text-[12px] text-ink-3">{s.window}</span>
      </div>
      <div className="mt-1.5 space-y-0.5 text-[12.5px]">
        {s.due_at ? <div className="text-ink-3">Due <span className="tabular text-ink-2">{fmtDue(s.due_at)}</span></div> : <div className="text-ink-3">No fixed deadline yet</div>}
        {done ? (
          <div className="text-petrol">
            Submitted <span className="tabular">{fmtDue(s.submitted_at)}</span>
            {due && <span className="text-ink-3">{done <= due ? `, ${duration(due - done)} before the deadline` : `, ${duration(done - due)} late`}</span>}
            {s.reference && <span className="text-ink-3">, reference <Code>{s.reference}</Code></span>}
          </div>
        ) : state === "overdue" && due ? (
          <div className="font-medium text-alarm" role="status">Overdue by {duration(now - due)}</div>
        ) : due ? (
          <div className={cn("tabular", state === "due_soon" ? "font-medium text-amber" : "text-ink-2")}>{duration(due - now)} left</div>
        ) : null}
        {s.info && <p className="text-[12px] text-ink-3">{s.info}</p>}
      </div>
      <div className="mt-1.5"><Cite c={s.ref} /></div>
      <ul className="mt-2 space-y-1">
        {s.checklist.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-[12.5px]">
            <Checkbox id={`chk-${t.id}-${s.stage}-${c.key}`} checked={c.done} disabled={!canEdit || m.isPending} className="mt-0.5"
              onCheckedChange={(v) => toggle(c.key, v === true)} />
            <label htmlFor={`chk-${t.id}-${s.stage}-${c.key}`} className={cn("leading-snug", c.done ? "text-ink-2" : "text-ink")}>{c.label}</label>
          </li>
        ))}
      </ul>
      {s.note && <p className="mt-1.5 text-[12px] whitespace-pre-line text-ink-3">{s.note}</p>}
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {done ? (
            <Confirm title={`Undo “${s.label}”?`} description="The report is marked as not submitted again." confirmLabel="Mark as not submitted" destructive={false}
              onConfirm={() => m.mutate({ method: "put", path, body: { submitted_at: null }, msg: `${s.label} marked as not submitted` })}
              trigger={<Button size="xs" variant="ghost">Undo</Button>} />
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => setDrafting(true)}>Draft report</Button>
              <Button size="sm" variant={state === "overdue" || state === "due_soon" ? "default" : "outline"} onClick={() => setSubmitting(true)}>Mark as submitted</Button>
            </>
          )}
          {s.stage === "intermediate" && !done && (
            <Button size="xs" variant="ghost" onClick={() => m.mutate({ method: "del", path, msg: "Request removed" })}>Remove request</Button>
          )}
        </div>
      )}
      {drafting && <ReportDraftDialog t={t} s={s} onClose={() => setDrafting(false)} />}
      {submitting && <SubmitDialog t={t} s={s} onClose={() => setSubmitting(false)} onSaved={(o) => { setSubmitting(false); onChanged(o) }} />}
    </li>
  )
}

function SubmitDialog({ t, s, onClose, onSaved }: { t: Track; s: Stage; onClose: () => void; onSaved: OnChanged }) {
  const [at, setAt] = useState(toLocalInput(new Date().toISOString()))
  const [ref, setRef] = useState(s.reference ?? t.reference ?? "")
  const [note, setNote] = useState(s.note ?? "")
  const save = useMutation({
    mutationFn: () => api.put<ReportingOverview>(`/incident-reporting/tracks/${t.id}/stages/${s.stage}`, {
      submitted_at: fromLocalInput(at), reference: ref.trim() || null, note: note.trim() || null }),
    onSuccess: (o) => { toast.success(`${s.label} marked as submitted`); onSaved(o) },
    onError: (e: Error) => toast.error(e.message),
  })
  const open = s.checklist.filter((c) => !c.done)
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{s.label} submitted</DialogTitle>
          <DialogDescription>{t.entity.code} to {t.authority}. Submission happens in the authority's portal; record it here.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Submitted at" htmlFor="sub-at"><Input id="sub-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
          <Field label="Reference" htmlFor="sub-ref" hint="Case or receipt number of the portal"><Input id="sub-ref" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={200} /></Field>
          <Field label="Note" htmlFor="sub-note"><Textarea id="sub-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {open.length > 0 && <p className="text-[12.5px] text-amber">{open.length} content item{open.length === 1 ? " is" : "s are"} not ticked in the checklist.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!at || save.isPending} onClick={() => save.mutate()}>Mark as submitted</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RequestDialog({ t, onClose, onSaved }: { t: Track; onClose: () => void; onSaved: OnChanged }) {
  const [at, setAt] = useState(toLocalInput(new Date().toISOString()))
  const [due, setDue] = useState("")
  const save = useMutation({
    mutationFn: () => api.put<ReportingOverview>(`/incident-reporting/tracks/${t.id}/stages/intermediate`, {
      requested_at: fromLocalInput(at), due_override: due ? fromLocalInput(due) : null }),
    onSuccess: (o) => { toast.success("Request recorded"); onSaved(o) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Intermediate report requested</DialogTitle>
          <DialogDescription>The {t.jurisdiction === "NL" ? "CSIRT or competent authority" : "BSI"} may request a status update (§ 32(1) Nr. 3 BSIG, Cbw Art. 28).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Requested at" htmlFor="req-at"><Input id="req-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
          <Field label="Deadline set by the authority" htmlFor="req-due" hint="Optional"><Input id="req-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!at || save.isPending} onClick={() => save.mutate()}>Record request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditTrackDialog({ t, onClose, onSaved }: { t: Track; onClose: () => void; onSaved: OnChanged }) {
  const [authority, setAuthority] = useState(t.authority)
  const [reference, setReference] = useState(t.reference ?? "")
  const [aware, setAware] = useState(toLocalInput(t.aware_at))
  const [notes, setNotes] = useState(t.notes ?? "")
  const save = useMutation({
    mutationFn: () => api.patch<ReportingOverview>(`/incident-reporting/tracks/${t.id}`, {
      authority: authority.trim(), reference: reference.trim() || null, aware_at: aware ? fromLocalInput(aware, t.aware_at) : null, notes: notes.trim() || null }),
    onSuccess: (o) => { toast.success("Track saved"); onSaved(o) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reporting track {t.entity.code}</DialogTitle>
          <DialogDescription>{REGIME_LABEL[t.regime]} track of {t.entity.name}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Authority" htmlFor="tr-auth"><Input id="tr-auth" value={authority} onChange={(e) => setAuthority(e.target.value)} maxLength={200} /></Field>
          <Field label="Case reference" htmlFor="tr-ref"><Input id="tr-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} /></Field>
          <Field label="Entity became aware at" htmlFor="tr-aware" hint="Only if different from the incident, e.g. the subsidiary learnt of it later">
            <Input id="tr-aware" type="datetime-local" value={aware} onChange={(e) => setAware(e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="tr-notes"><Textarea id="tr-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!authority.trim() || save.isPending} onClick={() => save.mutate()}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const AUTHORITY_SUGGESTIONS: Record<Regime, Record<string, string[]>> = {
  nis2: { DE: ["BSI (BSI-Portal, joint reporting office of BSI and BBK)"], NL: ["NCSC-NL and RDI via MijnNCSC", "Sector CSIRT and competent authority via MijnNCSC"] },
  gdpr: { DE: ["Data protection supervisory authority (Land)"], NL: ["Autoriteit Persoonsgegevens"] },
  cra: { DE: ["ENISA Single Reporting Platform (CSIRT coordinator)"], NL: ["ENISA Single Reporting Platform (CSIRT coordinator)"] },
}

function AddTrackDialog({ data, onClose, onSaved }: { data: ReportingOverview; onClose: () => void; onSaved: OnChanged }) {
  const editable = data.affected.filter((a) => a.can_edit)
  const [entity, setEntity] = useState<string | null>(editable[0] ? String(editable[0].entity.id) : null)
  const [regime, setRegime] = useState<Regime>(data.profile.personal_data_breach ? "gdpr" : "nis2")
  const [authority, setAuthority] = useState("")
  const [error, setError] = useState<string | null>(null)
  const country = editable.find((a) => String(a.entity.id) === entity)?.entity.country ?? "DE"
  const suggestions = AUTHORITY_SUGGESTIONS[regime][country === "NL" ? "NL" : "DE"]
  const save = useMutation({
    mutationFn: () => api.post<ReportingOverview>(`/incident-reporting/incidents/${data.incident_id}/tracks`, { entity_id: Number(entity), regime, authority: authority.trim() || null }),
    onMutate: () => setError(null),
    onSuccess: (o) => { toast.success("Reporting track added"); onSaved(o) },
    onError: (e: Error) => setError(e.message),
  })
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add reporting track</DialogTitle>
          <DialogDescription>A track covers the reports of one entity to one authority. NIS-2 tracks open automatically when the wizard finds the incident significant.</DialogDescription>
        </DialogHeader>
        {editable.length === 0 ? <p className="text-[13px] text-ink-3">Add the affected entities under scope and root cause first.</p> : (
          <div className="grid gap-3">
            <Field label="Entity">
              <OptionSelect value={entity} onChange={setEntity} options={editable.map((a) => ({ value: String(a.entity.id), label: `${a.entity.code} ${a.entity.name}` }))} />
            </Field>
            <Field label="Obligation">
              <OptionSelect value={regime} onChange={(v) => setRegime((v ?? "nis2") as Regime)} options={[
                { value: "nis2", label: "NIS-2 (24 h, 72 h, 1 month)" }, { value: "gdpr", label: "GDPR personal data breach (72 h, Art. 33)" },
                { value: "cra", label: "CRA product incident (24 h, 72 h, 1 month)" }]} />
            </Field>
            <Field label="Authority" htmlFor="add-auth" hint="Leave empty for the default of this entity">
              <Input id="add-auth" list="authority-suggestions" value={authority} onChange={(e) => setAuthority(e.target.value)} placeholder={suggestions[0]} />
              <datalist id="authority-suggestions">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
            </Field>
            {error && <ErrorState error={error} />}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!entity || save.isPending} onClick={() => save.mutate()}>Add track</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
