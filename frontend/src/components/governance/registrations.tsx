import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ClipboardCopy, FileCheck2, Plus, Send, Trash2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, EntityTag, ErrorState, Loading, Pill, Section } from "@/components/common/basics"
import { CommentsPanel, Confirm } from "@/components/common/collab"
import { Field, OptionSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { fmtDate, fmtDateTime, isoDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { CopyButton, DueBadge, govKeys, LinesInput, Meta, relDue } from "./shared"
import { REG_STATUS, REG_STATUS_LABEL, type Registration, type RegistrationChange, type RegistrationDetail, type RegistrationFields } from "./types"

const REG_TONE: Record<string, string> = { confirmed: "sage", submitted: "brass", draft: "neutral", not_registered: "alarm", withdrawn: "outline" }
/** Once the authority holds the data, changes must be reported and the record cannot go back to draft. */
const REGISTERED = ["submitted", "confirmed", "withdrawn"]

export function RegStatusPill({ status }: { status: string }) {
  return <Pill tone={REG_TONE[status] ?? "neutral"}>{REG_STATUS_LABEL[status] ?? status}</Pill>
}

const FIELDS: (keyof RegistrationFields)[] = [
  "portal", "status", "registration_number", "submitted_at", "registered_at", "legal_name", "legal_form", "register_number", "address",
  "entity_type", "contact_point", "contact_point_phone", "contact_point_email", "contact_person", "contact_person_phone",
  "contact_person_email", "public_ip_ranges", "domain_names", "sectors", "member_states", "authorities", "scope_rationale", "reviewed_at", "notes",
]
// portal fields whose change must be reported within two weeks
const REPORTABLE = new Set<keyof RegistrationFields>([
  "legal_name", "legal_form", "register_number", "address", "entity_type", "sectors", "contact_person", "contact_person_email",
  "contact_person_phone", "contact_point", "contact_point_email", "contact_point_phone", "public_ip_ranges", "domain_names",
  "member_states", "authorities",
])

const pick = (r: RegistrationFields): RegistrationFields => Object.fromEntries(FIELDS.map((k) => [k, r[k]])) as unknown as RegistrationFields
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/* ---------- report dialog ---------- */

function ReportDialog({ change, siblings, onOpenChange }: { change: RegistrationChange | null; siblings: RegistrationChange[]; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [date, setDate] = useState(isoDate(new Date()))
  const [ref, setRef] = useState("")
  const [note, setNote] = useState("")
  const [also, setAlso] = useState<number[]>([])
  useEffect(() => {
    if (change) { setDate(isoDate(new Date())); setRef(""); setNote(""); setAlso(siblings.filter((s) => s.id !== change.id).map((s) => s.id)) }
    // reset only when another change is opened; siblings is derived and recreated on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change])
  const save = useMutation({
    mutationFn: () => api.post<RegistrationChange[]>(`/governance/registration-changes/${change!.id}/report`, { reported_at: date, reference: ref.trim(), note: note.trim() || null, change_ids: also }),
    onSuccess: (r) => { toast.success(r.length > 1 ? `${r.length} changes marked as reported` : "Change marked as reported"); qc.invalidateQueries({ queryKey: govKeys.all }); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  const others = siblings.filter((s) => change && s.id !== change.id)
  return (
    <Dialog open={change != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark change as reported</DialogTitle>
          <DialogDescription>{change ? `${change.field_label} of ${change.entity_code}: record when and under which reference the change was reported to the authority.` : ""}</DialogDescription>
        </DialogHeader>
        <Field label="Reported on" htmlFor="rep-date"><Input id="rep-date" type="date" value={date} min={change?.known_at} max={isoDate(new Date())} onChange={(e) => setDate(e.target.value)} className="w-44" /></Field>
        <Field label="Reference" hint="Case or message number from the BSI portal or MijnNCSC" htmlFor="rep-ref"><Input id="rep-ref" value={ref} onChange={(e) => setRef(e.target.value)} className="font-mono text-[12.5px]" /></Field>
        {others.length > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[12.5px] font-medium text-ink-2">Reported in the same submission</legend>
            {others.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={also.includes(o.id)} onCheckedChange={(v) => setAlso((a) => (v ? [...a, o.id] : a.filter((x) => x !== o.id)))} />
                {o.field_label} <span className="text-ink-3">(known {fmtDate(o.known_at)})</span>
              </label>
            ))}
          </fieldset>
        )}
        <Field label="Note" htmlFor="rep-note"><Textarea id="rep-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!date || !ref.trim() || save.isPending} onClick={() => save.mutate()}><Send /> Mark as reported</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- edit form ---------- */

function TextField({ label, value, onChange, disabled, mono, type = "text", className, id }: {
  label: string; value: string | null; onChange: (v: string | null) => void; disabled?: boolean; mono?: boolean; type?: string; className?: string; id: string
}) {
  return (
    <Field label={label} className={className} htmlFor={id}>
      <Input id={id} type={type} value={value ?? ""} disabled={disabled} className={cn(mono && "font-mono text-[12.5px]")}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} />
    </Field>
  )
}

function RegistrationForm({ reg }: { reg: RegistrationDetail }) {
  const qc = useQueryClient()
  const [f, setF] = useState<RegistrationFields>(() => pick(reg))
  const [knownAt, setKnownAt] = useState(isoDate(new Date()))
  const [changeNote, setChangeNote] = useState("")
  const [formKey, setFormKey] = useState(0)
  const set = <K extends keyof RegistrationFields>(k: K, v: RegistrationFields[K]) => setF((x) => ({ ...x, [k]: v }))
  const base = pick(reg)
  const changed = FIELDS.filter((k) => !same(f[k], base[k]))
  const registered = REGISTERED.includes(reg.status)
  const reportable = registered ? changed.filter((k) => REPORTABLE.has(k)) : []
  const statusOptions = REG_STATUS.filter((o) => (registered ? ["submitted", "confirmed"].includes(o.value) || o.value === reg.status : o.value !== "withdrawn"))
  const dis = !reg.can_edit
  const save = useMutation({
    mutationFn: () => api.put<RegistrationDetail>(`/governance/registrations/${reg.id}`, { ...f, known_at: knownAt, change_note: changeNote.trim() || null }),
    onSuccess: (r) => {
      const n = r.changes.filter((c) => !c.reported_at).length - reg.changes.filter((c) => !c.reported_at).length
      toast.success(n > 0 ? `Saved. ${n} change${n > 1 ? "s" : ""} to report by ${fmtDate(r.next_change_due)}` : "Registration saved")
      qc.setQueryData(govKeys.registration(reg.id), r)
      qc.invalidateQueries({ queryKey: govKeys.all })
      qc.invalidateQueries({ queryKey: ["entities"] })
      setChangeNote("")
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const reset = () => { setF(pick(reg)); setFormKey((k) => k + 1) }
  const t = (k: keyof RegistrationFields, label: string, opts: { mono?: boolean; type?: string; className?: string } = {}) => (
    <TextField id={`reg-${k}`} label={label} value={f[k] as string | null} onChange={(v) => set(k, v as never)} disabled={dis} {...opts} />
  )
  const lines = (k: "public_ip_ranges" | "domain_names" | "sectors" | "member_states" | "authorities", label: string, placeholder: string) => (
    <Field label={label} hint="One per line" htmlFor={`reg-${k}`}>
      <LinesInput key={`${k}-${formKey}`} id={`reg-${k}`} value={f[k]} onChange={(v) => set(k, v)} placeholder={placeholder} disabled={dis} />
    </Field>
  )
  return (
    <div className="space-y-5">
      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="mb-2 text-[13px] font-semibold text-ink">Registration</legend>
        <Field label="Status"><OptionSelect value={f.status} onChange={(v) => set("status", (v ?? "draft") as RegistrationFields["status"])} options={statusOptions} disabled={dis} /></Field>
        {t("portal", "Portal")}
        {t("registration_number", "Registration number", { mono: true })}
        <div className="grid grid-cols-2 gap-3">
          {t("submitted_at", "Submitted on", { type: "date" })}
          {t("registered_at", "Confirmed on", { type: "date" })}
        </div>
      </fieldset>
      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="mb-2 text-[13px] font-semibold text-ink">Entity</legend>
        {t("legal_name", "Name of the entity", { className: "col-span-2" })}
        {t("legal_form", "Legal form")}
        {t("register_number", reg.jurisdiction === "NL" ? "KvK number" : "Commercial register number", { mono: true })}
        <Field label="Address" className="col-span-2" htmlFor="reg-address"><Textarea id="reg-address" rows={2} value={f.address ?? ""} disabled={dis} onChange={(e) => set("address", e.target.value || null)} /></Field>
        {t("entity_type", "Entity type", { className: "col-span-2" })}
      </fieldset>
      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="mb-2 text-[13px] font-semibold text-ink">Contacts</legend>
        {t("contact_person", "Contact person")}
        {t("contact_person_email", "Contact person e-mail", { type: "email" })}
        {t("contact_person_phone", "Contact person phone")}
        <span />
        {t("contact_point", "24/7 contact point")}
        {t("contact_point_email", "24/7 contact point e-mail", { type: "email" })}
        {t("contact_point_phone", "24/7 contact point phone")}
      </fieldset>
      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="mb-2 text-[13px] font-semibold text-ink">Scope and technical data</legend>
        {lines("public_ip_ranges", "Public IP address ranges", "198.51.100.0/24")}
        {lines("domain_names", "Domain names", "example.com")}
        {lines("sectors", "Sectors and sub-sectors", "Manufacturing of machinery")}
        {lines("member_states", "Member states where services are provided", "DE")}
        {lines("authorities", "Competent authorities", reg.jurisdiction === "NL" ? "RDI" : "BSI")}
        {t("reviewed_at", "Data last reviewed on", { type: "date" })}
        <Field label="Scope rationale" className="col-span-2" hint="Why the entity is in scope: size, sector annex, classification" htmlFor="reg-scope">
          <Textarea id="reg-scope" rows={3} value={f.scope_rationale ?? ""} disabled={dis} onChange={(e) => set("scope_rationale", e.target.value || null)} />
        </Field>
        <Field label="Internal notes" className="col-span-2" htmlFor="reg-notes">
          <Textarea id="reg-notes" rows={2} value={f.notes ?? ""} disabled={dis} onChange={(e) => set("notes", e.target.value || null)} />
        </Field>
      </fieldset>

      {reg.can_edit && (
        <div className="sticky bottom-0 -mx-5 space-y-3 border-t bg-card px-5 py-3">
          {reportable.length > 0 && (
            <div className="rounded-md border border-amber/40 bg-amber-50 p-3 text-[12.5px] text-ink-2">
              <div className="flex items-center gap-2 font-medium text-amber"><AlertTriangle className="size-4" /> {reportable.length} reportable field{reportable.length > 1 ? "s" : ""} changed</div>
              <p className="mt-1">Saving creates a change record due two weeks after the change became known ({reg.change_ref}). Governance managers are notified.</p>
              <div className="mt-2 grid grid-cols-[160px_1fr] gap-3">
                <Field label="Change known since" htmlFor="reg-known"><Input id="reg-known" type="date" value={knownAt} max={isoDate(new Date())} onChange={(e) => setKnownAt(e.target.value)} /></Field>
                <Field label="Reason for the change" htmlFor="reg-cnote"><Input id="reg-cnote" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} /></Field>
              </div>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-[12px] text-ink-3">{changed.length ? `${changed.length} unsaved change${changed.length > 1 ? "s" : ""}` : "No unsaved changes"}</span>
            <Button variant="outline" disabled={!changed.length} onClick={reset}>Discard</Button>
            <Button disabled={!changed.length || !knownAt || save.isPending} onClick={() => save.mutate()}>Save changes</Button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- detail sheet ---------- */

function CopySheet({ reg }: { reg: RegistrationDetail }) {
  const all = reg.sheet.filter((s) => s.value).map((s) => `${s.label}: ${s.value}`).join("\n")
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[12.5px] text-ink-3">Fields in the order of the {reg.jurisdiction === "NL" ? "MijnNCSC" : "BSI portal"} form. Copy each value into the portal.</p>
        <Button size="sm" variant="outline" disabled={!all} onClick={() => navigator.clipboard.writeText(all).then(() => toast.success("All fields copied"), () => toast.error("The browser did not allow copying to the clipboard"))}>
          <ClipboardCopy /> Copy all
        </Button>
      </div>
      <table className="w-full text-[13px]">
        <tbody>
          {reg.sheet.map((s, i) => (
            <tr key={s.field} className="border-b align-top last:border-0">
              <td className="tabular w-6 py-2 pr-2 text-[12px] text-ink-3">{i + 1}</td>
              <td className="w-[40%] py-2 pr-3">
                <div className="text-ink-2">{s.label}</div>
                <Code className="text-[11px] text-ink-3">{s.ref}</Code>
              </td>
              <td className="py-2 whitespace-pre-wrap break-words">{s.value ?? <span className="text-ink-3">Not recorded</span>}</td>
              <td className="w-8 py-1.5 text-right">{s.value && <CopyButton text={s.value} label={`Copy ${s.label}`} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChangeLog({ reg, onReport }: { reg: RegistrationDetail; onReport: (c: RegistrationChange) => void }) {
  if (!reg.changes.length) return <Empty title="No reportable changes recorded">Changes to portal fields after submission are listed here with their two-week deadline ({reg.change_ref}).</Empty>
  return (
    <ul className="space-y-2">
      {reg.changes.map((c) => (
        <li key={c.id} className={cn("rounded-md border p-3 text-[13px]", c.state === "overdue" && "border-alarm/40 bg-alarm-50/40")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{c.field_label}</span>
            <DueBadge state={c.state} />
            <span className="ml-auto text-[12px] text-ink-3">{c.reported_at ? `Reported ${fmtDate(c.reported_at)}` : `Due ${fmtDate(c.due_at)}, ${relDue(c.due_at)}`}</span>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-3 text-[12.5px]">
            <div><div className="text-ink-3">Before</div><div className="whitespace-pre-wrap break-words text-ink-2">{c.old_value ?? "–"}</div></div>
            <div><div className="text-ink-3">After</div><div className="whitespace-pre-wrap break-words text-ink">{c.new_value ?? "–"}</div></div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
            <span>Known since {fmtDate(c.known_at)}</span>
            {c.created_by && <span>Recorded by {c.created_by}</span>}
            {c.reported_reference && <span>Reference <Code className="text-[11.5px]">{c.reported_reference}</Code>{c.reported_by ? ` by ${c.reported_by}` : ""}</span>}
            {!c.reported_at && reg.can_edit && <Button size="xs" variant="outline" className="ml-auto" onClick={() => onReport(c)}><Send /> Mark as reported</Button>}
          </div>
          {c.note && <p className="mt-1 text-[12.5px] whitespace-pre-wrap text-ink-2">{c.note}</p>}
        </li>
      ))}
    </ul>
  )
}

function RegistrationSheet({ regId, onClose }: { regId: number | null; onClose: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: govKeys.registration(regId ?? 0), queryFn: () => api.get<RegistrationDetail>(`/governance/registrations/${regId}`), enabled: regId != null })
  const [reporting, setReporting] = useState<RegistrationChange | null>(null)
  const del = useMutation({
    mutationFn: () => api.del(`/governance/registrations/${regId}`),
    onSuccess: () => { toast.success("Registration record deleted"); qc.invalidateQueries({ queryKey: govKeys.all }); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  const reg = q.data
  const pending = reg?.changes.filter((c) => !c.reported_at) ?? []
  return (
    <Sheet open={regId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[760px]">
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} className="m-5" /> : reg && (
          <>
            <SheetHeader className="border-b px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <EntityTag code={reg.entity.code} name={reg.entity.name} />
                <Pill tone="outline">{reg.jurisdiction}</Pill>
                <RegStatusPill status={reg.status} />
                {reg.overdue_changes > 0 && <Pill tone="alarm">{reg.overdue_changes} change{reg.overdue_changes > 1 ? "s" : ""} overdue</Pill>}
              </div>
              <SheetTitle className="text-[16px]">Registration of {reg.entity.name}</SheetTitle>
              <SheetDescription>{reg.portal}{reg.registration_number ? `, registration number ${reg.registration_number}` : ""}. Last updated {fmtDateTime(reg.updated_at)}.</SheetDescription>
            </SheetHeader>
            <Tabs defaultValue={pending.length ? "changes" : "data"} className="px-5 py-4">
              <TabsList variant="line" className="mb-3">
                <TabsTrigger value="data">Data</TabsTrigger>
                <TabsTrigger value="sheet">Copy sheet</TabsTrigger>
                <TabsTrigger value="changes">Change log{pending.length ? ` (${pending.length} open)` : ""}</TabsTrigger>
                <TabsTrigger value="comments">Comments</TabsTrigger>
              </TabsList>
              <TabsContent value="data"><RegistrationForm key={reg.updated_at} reg={reg} /></TabsContent>
              <TabsContent value="sheet"><CopySheet reg={reg} /></TabsContent>
              <TabsContent value="changes"><ChangeLog reg={reg} onReport={setReporting} /></TabsContent>
              <TabsContent value="comments"><CommentsPanel targetType="registration" targetId={reg.id} canComment={reg.can_edit} /></TabsContent>
            </Tabs>
            {reg.can_edit && (reg.status === "submitted" || reg.status === "confirmed") && (
              <div className="border-t px-5 py-3">
                <WithdrawDialog reg={reg} />
              </div>
            )}
            {reg.can_edit && !REGISTERED.includes(reg.status) && !reg.submitted_at && !reg.registered_at && reg.changes.length === 0 && (
              <div className="border-t px-5 py-3">
                <Confirm title="Delete this registration record?" description="Only draft records that were never submitted can be deleted."
                  onConfirm={() => del.mutateAsync()} trigger={<Button size="sm" variant="ghost" className="text-alarm"><Trash2 /> Delete record</Button>} />
              </div>
            )}
            <ReportDialog change={reporting} siblings={pending} onOpenChange={(o) => !o && setReporting(null)} />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ---------- withdraw ---------- */

function WithdrawDialog({ reg }: { reg: RegistrationDetail }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [date, setDate] = useState(isoDate(new Date()))
  const save = useMutation({
    mutationFn: () => api.post<RegistrationDetail>(`/governance/registrations/${reg.id}/withdraw`, { reason: reason.trim(), withdrawn_at: date || null }),
    onSuccess: (r) => {
      toast.success("Registration withdrawn; the change history is kept")
      qc.setQueryData(govKeys.registration(reg.id), r)
      qc.invalidateQueries({ queryKey: govKeys.all })
      qc.invalidateQueries({ queryKey: ["entities"] })
      setOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setReason(""); setDate(isoDate(new Date())) } }}>
      <Button size="sm" variant="ghost" className="text-alarm" onClick={() => setOpen(true)}><Undo2 /> Withdraw registration</Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Withdraw registration</DialogTitle>
          <DialogDescription>Record that {reg.entity.name} was deregistered with the authority, for example because it left the scope. The record and its change history are kept; later changes are still logged.</DialogDescription>
        </DialogHeader>
        <Field label="Withdrawn on" htmlFor="wd-date"><Input id="wd-date" type="date" value={date} max={isoDate(new Date())} onChange={(e) => setDate(e.target.value)} className="w-44" /></Field>
        <Field label="Reason" htmlFor="wd-reason"><Textarea id="wd-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-alarm hover:bg-alarm/90" disabled={reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>Withdraw registration</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- create ---------- */

function CreateDialog({ entity, onOpenChange, onCreated }: { entity: { id: number; code: string; name: string; country: string | null } | null; onOpenChange: (o: boolean) => void; onCreated: (id: number) => void }) {
  const qc = useQueryClient()
  const [jur, setJur] = useState<string>("DE")
  useEffect(() => { if (entity) setJur(entity.country === "NL" ? "NL" : "DE") }, [entity])
  const save = useMutation({
    mutationFn: () => api.post<RegistrationDetail>("/governance/registrations", { entity_id: entity!.id, jurisdiction: jur, status: "draft", legal_name: entity!.name }),
    onSuccess: (r) => { toast.success(`Registration record for ${r.entity.code} created`); qc.invalidateQueries({ queryKey: govKeys.all }); onOpenChange(false); onCreated(r.id) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={entity != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create registration record</DialogTitle>
          <DialogDescription>{entity?.name}: collect the data the authority's registration portal asks for.</DialogDescription>
        </DialogHeader>
        <Field label="Jurisdiction"><OptionSelect value={jur} onChange={(v) => setJur(v ?? "DE")} options={[{ value: "DE", label: "Germany (BSI portal)" }, { value: "NL", label: "Netherlands (MijnNCSC)" }]} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Create record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- main view ---------- */

export function RegistrationsView() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const regs = useQuery({ queryKey: govKeys.registrations, queryFn: () => api.get<Registration[]>("/governance/registrations") })
  const changes = useQuery({ queryKey: govKeys.changes, queryFn: () => api.get<RegistrationChange[]>("/governance/registration-changes") })
  const entities = useEntities()
  const [creating, setCreating] = useState<{ id: number; code: string; name: string; country: string | null } | null>(null)
  const [reporting, setReporting] = useState<RegistrationChange | null>(null)
  const openId = Number(params.get("registration")) || null
  const setOpen = (id: number | null) => setParams((p) => { if (id) p.set("registration", String(id)); else p.delete("registration"); return p }, { replace: true })

  const byEntity = useMemo(() => {
    const m = new Map<number, Registration[]>()
    for (const r of regs.data ?? []) m.set(r.entity.id, [...(m.get(r.entity.id) ?? []), r])
    return m
  }, [regs.data])
  const visibleEntities = (entities.data ?? []).filter((e) => e.is_active && can("governance.read", e.id))
  const pending = changes.data ?? []

  if (regs.isLoading) return <Loading />
  if (regs.error) return <ErrorState error={regs.error} />

  return (
    <div className="space-y-5">
      <Section title={`Changes to report (${pending.length})`} bodyClassName="p-0">
        {pending.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">No open changes. When registration data changes after submission, it must be reported within two weeks (§ 33(5) BSIG, Cbw Art. 44(2)).</p>
        ) : (
          <ul>
            {pending.map((c) => (
              <li key={c.id} className="grid grid-cols-[60px_minmax(0,1fr)_150px_110px_auto] items-center gap-3 border-b px-4 py-2 text-[13px] last:border-0">
                {c.entity_code ? <EntityTag code={c.entity_code} /> : <span />}
                <button className="min-w-0 text-left" onClick={() => setOpen(c.registration_id)}>
                  <div className="truncate font-medium text-ink hover:text-petrol">{c.field_label}</div>
                  <div className="truncate text-[12px] text-ink-3">{c.old_value ?? "–"} to {c.new_value ?? "–"}</div>
                </button>
                <span className="tabular text-[12.5px]">Due {fmtDate(c.due_at)}<span className={cn("block text-[11.5px]", c.state === "overdue" ? "text-alarm" : "text-ink-3")}>{relDue(c.due_at)}</span></span>
                <DueBadge state={c.state} />
                {can("governance.manage", c.entity_id) ? <Button size="xs" variant="outline" onClick={() => setReporting(c)}><Send /> Mark as reported</Button> : <span />}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        {visibleEntities.map((e) => {
          const list = byEntity.get(e.id) ?? []
          return (
            <Section key={e.id} title={<span className="flex items-center gap-2"><EntityTag code={e.code} /> {e.name}</span>}
              actions={can("governance.manage", e.id) && !list.some((r) => r.jurisdiction === (e.country === "NL" ? "NL" : "DE")) ? (
                <Button size="xs" variant="outline" onClick={() => setCreating(e)}><Plus /> Create registration record</Button>
              ) : undefined}>
              {list.length === 0 ? (
                <p className="text-[13px] text-ink-3">No registration record yet. {e.country === "NL" ? "Dutch entities register via MijnNCSC with eHerkenning (Cbw Art. 44)." : "German entities register via the BSI portal (§ 33 BSIG)."}</p>
              ) : list.map((r) => (
                <button key={r.id} onClick={() => setOpen(r.id)} className="-m-1.5 block w-[calc(100%+12px)] rounded-md p-1.5 text-left hover:bg-muted/60">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="outline">{r.jurisdiction}</Pill>
                    <RegStatusPill status={r.status} />
                    <span className="text-[12.5px] text-ink-3">{r.portal}</span>
                    {r.pending_changes > 0 && <Pill tone={r.overdue_changes ? "alarm" : "amber"} className="ml-auto">{r.pending_changes} change{r.pending_changes > 1 ? "s" : ""} to report</Pill>}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-3">
                    <Meta label="Registration number">{r.registration_number ? <Code>{r.registration_number}</Code> : null}</Meta>
                    <Meta label={r.status === "confirmed" ? "Confirmed on" : "Submitted on"}>{r.status === "confirmed" ? fmtDate(r.registered_at) : r.submitted_at ? fmtDate(r.submitted_at) : null}</Meta>
                    <Meta label="Data reviewed">{r.reviewed_at ? fmtDate(r.reviewed_at) : null}</Meta>
                  </div>
                </button>
              ))}
            </Section>
          )
        })}
      </div>
      {visibleEntities.length === 0 && <Empty icon={<FileCheck2 className="size-6" />} title="No entities you can see">Ask an administrator for access to the governance data of your entity.</Empty>}

      <RegistrationSheet regId={openId} onClose={() => setOpen(null)} />
      <CreateDialog entity={creating} onOpenChange={(o) => !o && setCreating(null)} onCreated={(id) => setOpen(id)} />
      <ReportDialog change={reporting} siblings={pending.filter((p) => reporting && p.registration_id === reporting.registration_id)} onOpenChange={(o) => !o && setReporting(null)} />
    </div>
  )
}
