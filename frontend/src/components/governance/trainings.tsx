import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Award, GraduationCap, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, EntityTag, ErrorState, Loading, Pill, Section } from "@/components/common/basics"
import { CommentsPanel, Confirm, DocumentLinks } from "@/components/common/collab"
import { Field, OptionSelect, UserSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { EntityFilter, govKeys, LinesInput, Meta } from "./shared"
import type { BoardMember, TrainingRecord, TrainingRule } from "./types"

const LEGAL_REF_OPTIONS = ["§ 38(3) BSIG", "Cbw Art. 24(2)", "Cbb Art. 22"]

function duration(min: number | null) {
  if (min == null) return null
  const h = Math.floor(min / 60), m = min % 60
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`
}

/* ---------- rules ---------- */

function RuleDialog({ rule, onOpenChange }: { rule: TrainingRule | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ label: "", initial_months: "12", count_from: "", cadence_months: "", requires_certificate: false, note: "" })
  useEffect(() => {
    if (rule) setF({ label: rule.label, initial_months: String(rule.initial_months), count_from: rule.count_from ?? "", cadence_months: rule.cadence_months ? String(rule.cadence_months) : "", requires_certificate: rule.requires_certificate, note: rule.note ?? "" })
  }, [rule])
  const init = Number(f.initial_months), cad = f.cadence_months ? Number(f.cadence_months) : null
  const valid = f.label.trim() && init >= 1 && init <= 120 && (cad == null || (cad >= 1 && cad <= 120))
  const save = useMutation({
    mutationFn: () => api.put<TrainingRule>(`/governance/training-rules/${rule!.id}`, { label: f.label.trim(), initial_months: init, count_from: f.count_from || null, cadence_months: cad, requires_certificate: f.requires_certificate, note: f.note.trim() || null }),
    onSuccess: () => { toast.success("Training rule saved; deadlines recalculated"); qc.invalidateQueries({ queryKey: govKeys.all }); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={rule != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Training rule for {rule?.jurisdiction}</DialogTitle>
          <DialogDescription>{rule?.is_statutory ? "Statutory rule; change it only if the law or its interpretation changes." : "Company rule: the law requires regular training but sets no interval."}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Label" className="col-span-2" htmlFor="tr-label"><Input id="tr-label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
          <Field label="First training within (months)" hint="After appointment" htmlFor="tr-init"><Input id="tr-init" type="number" min={1} max={120} value={f.initial_months} onChange={(e) => setF({ ...f, initial_months: e.target.value })} /></Field>
          <Field label="Counting starts no earlier than" htmlFor="tr-from"><Input id="tr-from" type="date" value={f.count_from} onChange={(e) => setF({ ...f, count_from: e.target.value })} /></Field>
          <Field label="Repeat every (months)" hint="Empty = one-off" htmlFor="tr-cad"><Input id="tr-cad" type="number" min={1} max={120} value={f.cadence_months} onChange={(e) => setF({ ...f, cadence_months: e.target.value })} /></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-[13px]"><Switch checked={f.requires_certificate} onCheckedChange={(v) => setF({ ...f, requires_certificate: v })} /> Certificate required</label>
          <Field label="Note" className="col-span-2" htmlFor="tr-note"><Textarea id="tr-note" rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>Save rule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- record dialog ---------- */

interface Form {
  person_name: string; person_role: string; user_id: number | null; board_member_ids: number[]; entity_ids: number[]
  title: string; provider: string; delivery: "internal" | "external"; training_date: string; start_time: string; end_time: string
  duration_minutes: string; topics: string[]; legal_refs: string[]; has_certificate: boolean; cert_holder_name: string
  cert_issued_on: string; cert_dates: string; cert_topics: string; cert_provider: string; cert_language: string | null; notes: string
}
const empty = (): Form => ({
  person_name: "", person_role: "", user_id: null, board_member_ids: [], entity_ids: [], title: "", provider: "", delivery: "external",
  training_date: "", start_time: "", end_time: "", duration_minutes: "", topics: [], legal_refs: [], has_certificate: false,
  cert_holder_name: "", cert_issued_on: "", cert_dates: "", cert_topics: "", cert_provider: "", cert_language: null, notes: "",
})
const toForm = (t: TrainingRecord): Form => ({
  person_name: t.person_name, person_role: t.person_role ?? "", user_id: t.user_id, board_member_ids: t.board_member_ids, entity_ids: t.entity_ids,
  title: t.title, provider: t.provider ?? "", delivery: t.delivery, training_date: t.training_date, start_time: t.start_time ?? "", end_time: t.end_time ?? "",
  duration_minutes: t.duration_minutes != null ? String(t.duration_minutes) : "", topics: t.topics, legal_refs: t.legal_refs, has_certificate: t.has_certificate,
  cert_holder_name: t.cert_holder_name ?? "", cert_issued_on: t.cert_issued_on ?? "", cert_dates: t.cert_dates ?? "", cert_topics: t.cert_topics ?? "",
  cert_provider: t.cert_provider ?? "", cert_language: t.cert_language, notes: t.notes ?? "",
})

function TrainingDialog({ open, onOpenChange, training, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; training: TrainingRecord | null; onSaved?: (t: TrainingRecord) => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const entities = useEntities()
  const members = useQuery({ queryKey: govKeys.members, queryFn: () => api.get<BoardMember[]>("/governance/board-members"), enabled: open })
  const [f, setF] = useState<Form>(empty())
  const [k, setK] = useState(0)
  useEffect(() => { if (open) { setF(training ? toForm(training) : empty()); setK((x) => x + 1) } }, [open, training])
  const set = <K extends keyof Form>(key: K, v: Form[K]) => setF((x) => ({ ...x, [key]: v }))
  const memberList = (members.data ?? []).filter((m) => m.active || f.board_member_ids.includes(m.id))
  const derivedEntities = new Set([...f.entity_ids, ...memberList.filter((m) => f.board_member_ids.includes(m.id)).map((m) => m.entity_id)])
  const allowed = [...derivedEntities].every((e) => can("governance.manage", e)) && derivedEntities.size > 0
  const timesOk = !f.start_time || !f.end_time || f.end_time > f.start_time
  const valid = f.person_name.trim() && f.title.trim() && f.training_date && allowed && timesOk

  const toggleMember = (m: BoardMember, on: boolean) => {
    const ids = on ? [...f.board_member_ids, m.id] : f.board_member_ids.filter((x) => x !== m.id)
    setF((x) => ({
      ...x, board_member_ids: ids,
      person_name: x.person_name || (on ? m.name : x.person_name),
      person_role: x.person_role || (on ? m.function ?? "" : x.person_role),
      cert_holder_name: x.cert_holder_name || (on ? m.name : x.cert_holder_name),
      user_id: x.user_id ?? (on ? m.user_id : null),
    }))
  }

  const save = useMutation({
    mutationFn: () => {
      const s = (v: string) => v.trim() || null
      const body = {
        person_name: f.person_name.trim(), person_role: s(f.person_role), user_id: f.user_id, board_member_ids: f.board_member_ids, entity_ids: f.entity_ids,
        title: f.title.trim(), provider: s(f.provider), delivery: f.delivery, training_date: f.training_date, start_time: f.start_time || null,
        end_time: f.end_time || null, duration_minutes: f.duration_minutes ? Number(f.duration_minutes) : null, topics: f.topics, legal_refs: f.legal_refs,
        has_certificate: f.has_certificate, cert_holder_name: f.has_certificate ? s(f.cert_holder_name) : null, cert_issued_on: f.has_certificate ? f.cert_issued_on || null : null,
        cert_dates: f.has_certificate ? s(f.cert_dates) : null, cert_topics: f.has_certificate ? s(f.cert_topics) : null,
        cert_provider: f.has_certificate ? s(f.cert_provider) : null, cert_language: f.has_certificate ? f.cert_language : null, notes: s(f.notes),
      }
      return training ? api.put<TrainingRecord>(`/governance/trainings/${training.id}`, body) : api.post<TrainingRecord>("/governance/trainings", body)
    },
    onSuccess: (t) => { toast.success(training ? "Training record saved" : "Training recorded; status and deadlines updated"); qc.invalidateQueries({ queryKey: govKeys.all }); onOpenChange(false); onSaved?.(t) },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{training ? "Edit training record" : "Record training"}</DialogTitle>
          <DialogDescription>Fields follow the BSI guidance on documenting management training and, for Dutch board members, Cbb Art. 22.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[68vh] grid-cols-2 gap-3 overflow-y-auto scroll-thin pr-1">
          <fieldset className="col-span-2 space-y-1.5">
            <legend className="mb-1 text-[12.5px] font-medium text-ink-2">Management body member(s)</legend>
            {members.isLoading ? <Loading className="p-2" /> : memberList.length === 0 ? <p className="text-[12.5px] text-ink-3">No members recorded. Training for other persons can be recorded with an entity below.</p> : (
              <div className="grid max-h-36 grid-cols-2 gap-1 overflow-y-auto scroll-thin rounded-md border p-2">
                {memberList.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-[13px]">
                    <Checkbox checked={f.board_member_ids.includes(m.id)} onCheckedChange={(v) => toggleMember(m, !!v)} />
                    <EntityTag code={m.entity.code} /> <span className="truncate">{m.name}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <Field label="Person" htmlFor="t-person"><Input id="t-person" value={f.person_name} onChange={(e) => set("person_name", e.target.value)} /></Field>
          <Field label="Role of the person" htmlFor="t-role"><Input id="t-role" value={f.person_role} onChange={(e) => set("person_role", e.target.value)} /></Field>
          <Field label="Further entities" hint="Entities of the selected members are added automatically" className="col-span-2">
            <div className="flex flex-wrap gap-3 rounded-md border px-3 py-2">
              {(entities.data ?? []).filter((e) => e.is_active).map((e) => (
                <label key={e.id} className="flex items-center gap-1.5 text-[13px]">
                  <Checkbox checked={derivedEntities.has(e.id)} disabled={memberList.some((m) => f.board_member_ids.includes(m.id) && m.entity_id === e.id)}
                    onCheckedChange={(v) => set("entity_ids", v ? [...f.entity_ids, e.id] : f.entity_ids.filter((x) => x !== e.id))} />
                  <EntityTag code={e.code} name={e.name} />
                </label>
              ))}
            </div>
          </Field>
          <Field label="User account" hint="Optional"><UserSelect value={f.user_id} onChange={(v) => set("user_id", v)} placeholder="No user account" /></Field>
          <span />
          <Field label="Training title" className="col-span-2" htmlFor="t-title"><Input id="t-title" value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="Provider" htmlFor="t-prov"><Input id="t-prov" value={f.provider} onChange={(e) => set("provider", e.target.value)} /></Field>
          <Field label="Delivery"><OptionSelect value={f.delivery} onChange={(v) => set("delivery", (v ?? "external") as Form["delivery"])} options={[{ value: "external", label: "External" }, { value: "internal", label: "Internal" }]} /></Field>
          <Field label="Date" htmlFor="t-date"><Input id="t-date" type="date" value={f.training_date} onChange={(e) => set("training_date", e.target.value)} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Start" htmlFor="t-start"><Input id="t-start" type="time" value={f.start_time} onChange={(e) => set("start_time", e.target.value)} /></Field>
            <Field label="End" htmlFor="t-end"><Input id="t-end" type="time" value={f.end_time} onChange={(e) => set("end_time", e.target.value)} /></Field>
            <Field label="Minutes" htmlFor="t-dur"><Input id="t-dur" type="number" min={0} value={f.duration_minutes} placeholder={f.start_time && f.end_time ? "auto" : ""} onChange={(e) => set("duration_minutes", e.target.value)} /></Field>
          </div>
          {!timesOk && <p className="col-span-2 text-[12.5px] text-alarm">The end time must be after the start time.</p>}
          <Field label="Topics" hint="One per line" className="col-span-2" htmlFor="t-topics"><LinesInput key={`topics-${k}`} id="t-topics" value={f.topics} onChange={(v) => set("topics", v)} /></Field>
          <Field label="Legal references" className="col-span-2">
            <div className="flex flex-wrap gap-3">
              {[...new Set([...LEGAL_REF_OPTIONS, ...f.legal_refs])].map((r) => (
                <label key={r} className="flex items-center gap-1.5 text-[13px]">
                  <Checkbox checked={f.legal_refs.includes(r)} onCheckedChange={(v) => set("legal_refs", v ? [...f.legal_refs, r] : f.legal_refs.filter((x) => x !== r))} />
                  <Code>{r}</Code>
                </label>
              ))}
            </div>
          </Field>
          <label className="col-span-2 flex items-center gap-2 border-t pt-3 text-[13px] font-medium">
            <Switch checked={f.has_certificate} onCheckedChange={(v) => set("has_certificate", v)} /> Certificate issued
          </label>
          {f.has_certificate && (
            <>
              <Field label="Name on the certificate" htmlFor="c-name"><Input id="c-name" value={f.cert_holder_name} onChange={(e) => set("cert_holder_name", e.target.value)} /></Field>
              <Field label="Issued on" htmlFor="c-date"><Input id="c-date" type="date" value={f.cert_issued_on} onChange={(e) => set("cert_issued_on", e.target.value)} /></Field>
              <Field label="Training dates on the certificate" htmlFor="c-dates"><Input id="c-dates" value={f.cert_dates} onChange={(e) => set("cert_dates", e.target.value)} /></Field>
              <Field label="Provider on the certificate" htmlFor="c-prov"><Input id="c-prov" value={f.cert_provider} onChange={(e) => set("cert_provider", e.target.value)} /></Field>
              <Field label="Language"><OptionSelect value={f.cert_language} onChange={(v) => set("cert_language", v)} allowNone noneLabel="Not recorded" options={[{ value: "NL", label: "Dutch" }, { value: "EN", label: "English" }, { value: "DE", label: "German" }]} /></Field>
              <span />
              <Field label="Topics on the certificate" className="col-span-2" htmlFor="c-topics"><Textarea id="c-topics" rows={2} value={f.cert_topics} onChange={(e) => set("cert_topics", e.target.value)} /></Field>
              {f.cert_language === "DE" && <p className="col-span-2 text-[12.5px] text-amber">Cbb Art. 22 requires the certificate in Dutch or English.</p>}
            </>
          )}
          <Field label="Notes" className="col-span-2" htmlFor="t-notes"><Textarea id="t-notes" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        </div>
        {!allowed && <p className="text-[12.5px] text-alarm">{derivedEntities.size === 0 ? "Select at least one member or entity." : "You cannot manage governance data for all selected entities."}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{training ? "Save changes" : "Record training"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- detail sheet ---------- */

function TrainingSheet({ id, onClose, onEdit }: { id: number | null; onClose: () => void; onEdit: (t: TrainingRecord) => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: govKeys.training(id ?? 0), queryFn: () => api.get<TrainingRecord>(`/governance/trainings/${id}`), enabled: id != null })
  const del = useMutation({
    mutationFn: () => api.del(`/governance/trainings/${id}`),
    onSuccess: () => { toast.success("Training record deleted"); qc.invalidateQueries({ queryKey: govKeys.all }); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  const t = q.data
  return (
    <Sheet open={id != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[600px]">
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} className="m-5" /> : t && (
          <>
            <SheetHeader className="border-b px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                {t.entities.map((e) => <EntityTag key={e.id} code={e.code} name={e.name} />)}
                <Pill tone="outline">{t.delivery === "internal" ? "Internal" : "External"}</Pill>
                {t.has_certificate && <Pill tone="sage"><Award className="size-3" /> Certificate</Pill>}
              </div>
              <SheetTitle className="text-[16px]">{t.title}</SheetTitle>
              <SheetDescription>{t.person_name}{t.person_role ? `, ${t.person_role}` : ""}. {fmtDate(t.training_date)}{t.start_time ? `, ${t.start_time} to ${t.end_time ?? "?"}` : ""}</SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-5 py-4">
              {t.can_edit && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(t)}><Pencil /> Edit</Button>
                  <Confirm title="Delete this training record?" description="Training status and deadlines of the linked members are recalculated." onConfirm={() => del.mutateAsync()}
                    trigger={<Button size="sm" variant="ghost" className="text-alarm"><Trash2 /> Delete</Button>} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Meta label="Provider">{t.provider}</Meta>
                <Meta label="Duration">{duration(t.duration_minutes)}</Meta>
                <Meta label="Members">{t.board_members.length ? t.board_members.map((m) => `${m.name} (${m.entity_code})`).join(", ") : null}</Meta>
                <Meta label="Legal references">{t.legal_refs.length ? <span className="flex flex-wrap gap-2">{t.legal_refs.map((r) => <Code key={r}>{r}</Code>)}</span> : null}</Meta>
              </div>
              {t.topics.length > 0 && (
                <div>
                  <div className="mb-1 text-[12px] text-ink-3">Topics</div>
                  <ul className="list-disc space-y-0.5 pl-5 text-[13px]">{t.topics.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              )}
              {t.has_certificate && (
                <div className="rounded-md border p-3">
                  <div className="mb-2 text-[13px] font-semibold">Certificate</div>
                  <div className="grid grid-cols-2 gap-3">
                    <Meta label="Name">{t.cert_holder_name}</Meta>
                    <Meta label="Issued on">{t.cert_issued_on ? fmtDate(t.cert_issued_on) : null}</Meta>
                    <Meta label="Training dates">{t.cert_dates}</Meta>
                    <Meta label="Provider">{t.cert_provider}</Meta>
                    <Meta label="Language">{t.cert_language}</Meta>
                    <Meta label="Topics">{t.cert_topics}</Meta>
                  </div>
                </div>
              )}
              {t.notes && <p className="text-[13px] whitespace-pre-wrap text-ink-2">{t.notes}</p>}
              <div>
                <h3 className="mb-2 text-[13px] font-semibold">Certificate and attendance documents</h3>
                <DocumentLinks targetType="training" targetId={t.id} documents={t.documents ?? []} entityId={t.entity_ids.length === 1 ? t.entity_ids[0] : null}
                  canEdit={t.can_edit} onChange={() => qc.invalidateQueries({ queryKey: govKeys.training(t.id) })} />
              </div>
              <div>
                <h3 className="mb-2 text-[13px] font-semibold">Comments</h3>
                <CommentsPanel targetType="training" targetId={t.id} canComment={t.can_edit} />
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ---------- main view ---------- */

export function TrainingsView() {
  const { canAny, canGlobal } = useAuth()
  const [params, setParams] = useSearchParams()
  const [entity, setEntity] = useState<number | null>(null)
  const [text, setText] = useState("")
  const [dlg, setDlg] = useState<{ open: boolean; training: TrainingRecord | null }>({ open: false, training: null })
  const [editRule, setEditRule] = useState<TrainingRule | null>(null)
  const list = useQuery({ queryKey: govKeys.trainings, queryFn: () => api.get<TrainingRecord[]>("/governance/trainings") })
  const rules = useQuery({ queryKey: govKeys.rules, queryFn: () => api.get<TrainingRule[]>("/governance/training-rules") })
  const openId = Number(params.get("training")) || null
  const setOpen = (id: number | null) => setParams((p) => { if (id) p.set("training", String(id)); else p.delete("training"); return p }, { replace: true })

  const rows = useMemo(() => {
    const q = text.trim().toLowerCase()
    return (list.data ?? []).filter((t) => (entity == null || t.entity_ids.includes(entity))
      && (!q || `${t.person_name} ${t.title} ${t.provider ?? ""} ${t.topics.join(" ")}`.toLowerCase().includes(q)))
  }, [list.data, entity, text])

  if (list.isLoading) return <Loading />
  if (list.error) return <ErrorState error={list.error} />

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        {(rules.data ?? []).map((r) => (
          <Section key={r.id} title={<span className="flex items-center gap-2"><Pill tone="outline">{r.jurisdiction}</Pill> {r.label}</span>}
            actions={canGlobal("governance.manage") ? <Button size="xs" variant="ghost" onClick={() => setEditRule(r)}><Pencil /> Edit rule</Button> : undefined}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Pill tone={r.is_statutory ? "petrol" : "brass"}>{r.is_statutory ? "Statutory" : "Company rule"}</Pill>
              {r.legal_ref && <Code>{r.legal_ref}</Code>}
              {r.requires_certificate && <Pill tone="outline">Certificate required</Pill>}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Meta label="First training">{`within ${r.initial_months} months`}</Meta>
              <Meta label="Counting from">{r.count_from ? `no earlier than ${fmtDate(r.count_from)}` : "appointment"}</Meta>
              <Meta label="Repeat">{r.cadence_months ? `every ${r.cadence_months} months` : "one-off"}</Meta>
            </div>
            {r.note && <p className="mt-2 text-[12.5px] text-ink-3">{r.note}</p>}
          </Section>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <EntityFilter value={entity} onChange={setEntity} className="w-60" />
        <div className="relative w-64">
          <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Person, title, provider or topic" className="pl-8" aria-label="Search training records" />
          {text && <button className="absolute top-2.5 right-2.5 text-ink-3 hover:text-ink" onClick={() => setText("")} aria-label="Clear search"><X className="size-4" /></button>}
        </div>
        {canAny("governance.manage") && <Button className="ml-auto" onClick={() => setDlg({ open: true, training: null })}><Plus /> Record training</Button>}
      </div>

      <Section title={`Training records (${rows.length})`} bodyClassName="p-0">
        {rows.length === 0 ? (
          <Empty icon={<GraduationCap className="size-6" />} title="No training records match">Record management training with provider, date, duration and topics; attach certificates for Dutch board members.</Empty>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Person</th>
                  <th className="px-3 py-2 font-medium">Training</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                  <th className="px-3 py-2 font-medium">Entities</th>
                  <th className="px-3 py-2 font-medium">Certificate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/40", openId === t.id && "bg-petrol-50/60")} onClick={() => setOpen(t.id)}>
                    <td className="tabular px-4 py-2 whitespace-nowrap text-ink-2">{fmtDate(t.training_date)}</td>
                    <td className="px-3 py-2"><div className="font-medium text-ink">{t.person_name}</div><div className="text-[12px] text-ink-3">{t.person_role}</div></td>
                    <td className="px-3 py-2">
                      <button className="text-left hover:text-petrol" onClick={(e) => { e.stopPropagation(); setOpen(t.id) }}>{t.title}</button>
                      <div className="text-[12px] text-ink-3">{t.provider}{t.delivery === "internal" ? " (internal)" : ""}</div>
                    </td>
                    <td className="tabular px-3 py-2 text-ink-2">{duration(t.duration_minutes) ?? "–"}</td>
                    <td className="px-3 py-2"><span className="flex flex-wrap gap-1">{t.entities.map((e) => <EntityTag key={e.id} code={e.code} name={e.name} />)}</span></td>
                    <td className="px-3 py-2">{t.has_certificate ? <Pill tone="sage">{t.cert_language ?? "Yes"}</Pill> : <span className="text-ink-3">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <TrainingDialog open={dlg.open} training={dlg.training} onOpenChange={(o) => !o && setDlg({ open: false, training: null })} onSaved={(t) => setOpen(t.id)} />
      <TrainingSheet id={openId} onClose={() => setOpen(null)} onEdit={(t) => setDlg({ open: true, training: t })} />
      <RuleDialog rule={editRule} onOpenChange={(o) => !o && setEditRule(null)} />
    </div>
  )
}
