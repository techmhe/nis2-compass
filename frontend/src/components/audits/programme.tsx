import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardList, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { WritingHelp } from "@/components/ai/writing-help"
import { Code, Empty, EntityTag, ErrorState, Loading, Section } from "@/components/common/basics"
import { Confirm, DocumentLinks } from "@/components/common/collab"
import { EntitySelect, Field, OptionSelect, UserSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate, isoDate } from "@/lib/format"
import { FindingDialog, FindingRow } from "./findings"
import { AuditStatusPill, EntityFilter, GroupPill, Meta, auditKeys, invalidateAudits, useProgrammes } from "./shared"
import { AUDIT_STATUS, AUDIT_TYPES, AUDIT_TYPE_LABEL, type Audit, type AuditProgramme } from "./types"

/* ---------- programme dialog ---------- */

interface ProgForm { year: number; title: string; scope: string; approved_by: string; approved_on: string }
const emptyProg = (): ProgForm => ({ year: new Date().getFullYear() + 1, title: "", scope: "", approved_by: "", approved_on: "" })
const toProgForm = (p: AuditProgramme): ProgForm => ({ year: p.year, title: p.title, scope: p.scope ?? "", approved_by: p.approved_by ?? "", approved_on: p.approved_on ?? "" })

function ProgrammeDialog({ open, onOpenChange, programme }: { open: boolean; onOpenChange: (o: boolean) => void; programme?: AuditProgramme | null }) {
  const qc = useQueryClient()
  const { canGlobal } = useAuth()
  const [f, setF] = useState<ProgForm>(emptyProg())
  useEffect(() => { if (open) setF(programme ? toProgForm(programme) : emptyProg()) }, [open, programme])
  const set = <K extends keyof ProgForm>(k: K, v: ProgForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const valid = f.title.trim() && f.year >= 2020 && canGlobal("audits.manage")
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, title: f.title.trim(), scope: f.scope.trim() || null, approved_by: f.approved_by.trim() || null, approved_on: f.approved_on || null }
      return programme ? api.put<AuditProgramme>(`/audits/programmes/${programme.id}`, body) : api.post<AuditProgramme>("/audits/programmes", body)
    },
    onSuccess: () => { toast.success(programme ? "Programme saved" : "Audit programme created"); invalidateAudits(qc); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{programme ? "Edit audit programme" : "New audit programme"}</DialogTitle>
          <DialogDescription>The yearly plan for internal, external, certification, supplier and authority audits (ISO 9.2.2 a).</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Year" htmlFor="prog-year"><Input id="prog-year" type="number" value={f.year} onChange={(e) => set("year", Number(e.target.value))} /></Field>
          <Field label="Approved on" htmlFor="prog-appr"><Input id="prog-appr" type="date" value={f.approved_on} onChange={(e) => set("approved_on", e.target.value)} /></Field>
          <Field label="Title" className="col-span-2" htmlFor="prog-title"><Input id="prog-title" value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="Approved by" htmlFor="prog-by"><Input id="prog-by" value={f.approved_by} onChange={(e) => set("approved_by", e.target.value)} /></Field>
          <Field label="Scope" className="col-span-2" htmlFor="prog-scope"><Textarea id="prog-scope" rows={3} value={f.scope} onChange={(e) => set("scope", e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{programme ? "Save changes" : "Create programme"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- audit dialog ---------- */

interface AuditForm {
  programme_id: number | null; type: string; entity_id: number | null; scope: string; requirement_chapter: string
  lead_auditor_id: number | null; auditors: string; planned_start: string; planned_end: string
  actual_start: string; actual_end: string; status: string; summary: string; conclusion: string
}
const emptyAudit = (entityId: number | null): AuditForm => ({
  programme_id: null, type: "internal", entity_id: entityId, scope: "", requirement_chapter: "", lead_auditor_id: null,
  auditors: "", planned_start: isoDate(new Date()), planned_end: isoDate(new Date()), actual_start: "", actual_end: "",
  status: "planned", summary: "", conclusion: "",
})
const toAuditForm = (a: Audit): AuditForm => ({
  programme_id: a.programme_id, type: a.type, entity_id: a.entity_id, scope: a.scope, requirement_chapter: a.requirement_chapter ?? "",
  lead_auditor_id: a.lead_auditor_id, auditors: a.auditors ?? "", planned_start: a.planned_start, planned_end: a.planned_end,
  actual_start: a.actual_start ?? "", actual_end: a.actual_end ?? "", status: a.status, summary: a.summary ?? "", conclusion: a.conclusion ?? "",
})

function AuditDialog({ open, onOpenChange, audit, defaultEntity, programmes }: {
  open: boolean; onOpenChange: (o: boolean) => void; audit?: Audit | null; defaultEntity: number | null; programmes: AuditProgramme[]
}) {
  const qc = useQueryClient()
  const { can, canGlobal } = useAuth()
  const [f, setF] = useState<AuditForm>(emptyAudit(defaultEntity))
  useEffect(() => { if (open) setF(audit ? toAuditForm(audit) : emptyAudit(defaultEntity)) }, [open, audit, defaultEntity])
  const set = <K extends keyof AuditForm>(k: K, v: AuditForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const allowed = f.entity_id == null ? canGlobal("audits.manage") : can("audits.manage", f.entity_id)
  const valid = f.scope.trim() && f.planned_start && f.planned_end && f.planned_end >= f.planned_start && allowed
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, scope: f.scope.trim(), requirement_chapter: f.requirement_chapter.trim() || null,
        auditors: f.auditors.trim() || null, actual_start: f.actual_start || null, actual_end: f.actual_end || null,
        summary: f.summary.trim() || null, conclusion: f.conclusion.trim() || null }
      return audit ? api.put<Audit>(`/audits/audits/${audit.id}`, body) : api.post<Audit>("/audits/audits", body)
    },
    onSuccess: (a) => { toast.success(audit ? `${a.code} saved` : `Audit ${a.code} created`); invalidateAudits(qc); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{audit ? `Edit ${audit.code}` : "New audit"}</DialogTitle>
          <DialogDescription>Internal, external, certification, supplier or authority audit (ISO 9.2, IR 2024/2690 2.2).</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto scroll-thin pr-1">
          <Field label="Type"><OptionSelect value={f.type} onChange={(v) => set("type", v ?? "internal")} options={AUDIT_TYPES} /></Field>
          <Field label="Entity"><EntitySelect value={f.entity_id} onChange={(v) => set("entity_id", v)} groupLabel="Group-wide" /></Field>
          <Field label="Programme" className="col-span-2">
            <OptionSelect value={f.programme_id != null ? String(f.programme_id) : null} onChange={(v) => set("programme_id", v ? Number(v) : null)}
              allowNone noneLabel="No programme" placeholder="No programme" options={programmes.map((p) => ({ value: String(p.id), label: `${p.year} – ${p.title}` }))} />
          </Field>
          <Field label="Scope" className="col-span-2" htmlFor="a-scope"><Textarea id="a-scope" rows={2} value={f.scope} onChange={(e) => set("scope", e.target.value)} /></Field>
          <Field label="Requirement / chapter scope" htmlFor="a-chap"><Input id="a-chap" value={f.requirement_chapter} onChange={(e) => set("requirement_chapter", e.target.value)} placeholder="e.g. chapter 9" /></Field>
          <Field label="Status"><OptionSelect value={f.status} onChange={(v) => set("status", v ?? "planned")} options={AUDIT_STATUS} /></Field>
          <Field label="Lead auditor"><UserSelect value={f.lead_auditor_id} onChange={(v) => set("lead_auditor_id", v)} placeholder="No lead auditor" /></Field>
          <Field label="Other auditors" htmlFor="a-auditors"><Input id="a-auditors" value={f.auditors} onChange={(e) => set("auditors", e.target.value)} placeholder="Free text" /></Field>
          <Field label="Planned start" htmlFor="a-ps"><Input id="a-ps" type="date" value={f.planned_start} onChange={(e) => set("planned_start", e.target.value)} /></Field>
          <Field label="Planned end" htmlFor="a-pe"><Input id="a-pe" type="date" value={f.planned_end} onChange={(e) => set("planned_end", e.target.value)} /></Field>
          <Field label="Actual start" htmlFor="a-as"><Input id="a-as" type="date" value={f.actual_start} onChange={(e) => set("actual_start", e.target.value)} /></Field>
          <Field label="Actual end" htmlFor="a-ae"><Input id="a-ae" type="date" value={f.actual_end} onChange={(e) => set("actual_end", e.target.value)} /></Field>
          <Field label="Summary" className="col-span-2" htmlFor="a-sum" action={audit && <WritingHelp target={{ type: "audit", id: audit.id }} field="summary" value={f.summary} onApply={(t) => set("summary", t)} autosave={false} />}><Textarea id="a-sum" rows={2} value={f.summary} onChange={(e) => set("summary", e.target.value)} /></Field>
          <Field label="Conclusion" className="col-span-2" htmlFor="a-conc" action={audit && <WritingHelp target={{ type: "audit", id: audit.id }} field="conclusion" value={f.conclusion} onApply={(t) => set("conclusion", t)} autosave={false} />}><Textarea id="a-conc" rows={2} value={f.conclusion} onChange={(e) => set("conclusion", e.target.value)} /></Field>
        </div>
        {!allowed && <p className="text-[12.5px] text-alarm">You cannot manage audits for the selected scope.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{audit ? "Save changes" : "Create audit"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- audit detail sheet ---------- */

function AuditSheet({ auditId, onClose, onEdit }: { auditId: number | null; onClose: () => void; onEdit: (a: Audit) => void }) {
  const qc = useQueryClient()
  const [creatingFinding, setCreatingFinding] = useState(false)
  const q = useQuery({ queryKey: auditKeys.audit(auditId ?? 0), queryFn: () => api.get<Audit>(`/audits/audits/${auditId}`), enabled: auditId != null })
  const del = useMutation({
    mutationFn: () => api.del(`/audits/audits/${auditId}`),
    onSuccess: () => { toast.success("Audit deleted"); invalidateAudits(qc); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  const a = q.data
  return (
    <Sheet open={auditId != null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[640px]">
        {a && (
          <>
            <SheetHeader className="border-b px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                {a.entity ? <EntityTag code={a.entity.code} name={a.entity.name} /> : <GroupPill />}
                <AuditStatusPill status={a.status} />
                <Code className="text-[11.5px]">{AUDIT_TYPE_LABEL[a.type]}</Code>
              </div>
              <SheetTitle className="text-[16px]">{a.code}</SheetTitle>
              <SheetDescription className="whitespace-pre-wrap">{a.scope}</SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-5 py-4">
              <div className="flex flex-wrap gap-2">
                {a.can_edit && <Button size="sm" variant="outline" onClick={() => onEdit(a)}><Pencil /> Edit</Button>}
                {a.can_edit && <Button size="sm" variant="outline" onClick={() => setCreatingFinding(true)}><Plus /> Add finding</Button>}
                {a.can_edit && (
                  <Confirm title={`Delete ${a.code}?`} description="Its findings are deleted with it." onConfirm={() => del.mutateAsync()}
                    trigger={<Button size="sm" variant="ghost" className="text-alarm hover:text-alarm"><Trash2 /> Delete</Button>} />
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Meta label="Programme">{a.programme_title}</Meta>
                <Meta label="Requirement / chapter scope">{a.requirement_chapter}</Meta>
                <Meta label="Lead auditor">{a.lead_auditor_name}</Meta>
                <Meta label="Other auditors">{a.auditors}</Meta>
                <Meta label="Planned">{fmtDate(a.planned_start)} – {fmtDate(a.planned_end)}</Meta>
                <Meta label="Actual">{a.actual_start ? `${fmtDate(a.actual_start)} – ${a.actual_end ? fmtDate(a.actual_end) : "…"}` : null}</Meta>
              </div>
              {a.summary && <div><h3 className="mb-1 text-[13px] font-semibold">Summary</h3><p className="text-[13px] whitespace-pre-wrap text-ink-2">{a.summary}</p></div>}
              {a.conclusion && <div><h3 className="mb-1 text-[13px] font-semibold">Conclusion</h3><p className="text-[13px] whitespace-pre-wrap text-ink-2">{a.conclusion}</p></div>}
              <div>
                <h3 className="mb-2 text-[13px] font-semibold">Findings ({a.findings?.length ?? 0})</h3>
                {!a.findings?.length ? <p className="text-[12.5px] text-ink-3">No findings recorded.</p> : (
                  <ul className="divide-y rounded-md border">
                    {a.findings.map((f) => <FindingRow key={f.id} finding={f} showAudit={false} />)}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-[13px] font-semibold">Report and evidence</h3>
                <DocumentLinks targetType="audit" targetId={a.id} documents={a.documents ?? []} entityId={a.entity_id} canEdit={a.can_edit}
                  onChange={() => qc.invalidateQueries({ queryKey: auditKeys.audit(a.id) })} />
              </div>
            </div>
            <FindingDialog open={creatingFinding} onOpenChange={setCreatingFinding} auditId={a.id} defaultEntity={a.entity_id} />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ---------- main view ---------- */

export function ProgrammeAuditsView() {
  const { canAny } = useAuth()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [entity, setEntity] = useState<number | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [creatingProg, setCreatingProg] = useState(false)
  const [editingProg, setEditingProg] = useState<AuditProgramme | null>(null)
  const [creatingAudit, setCreatingAudit] = useState(false)
  const [editingAudit, setEditingAudit] = useState<Audit | null>(null)
  const progs = useProgrammes()
  const audits = useQuery({ queryKey: auditKeys.audits, queryFn: () => api.get<Audit[]>("/audits/audits") })
  const canManage = canAny("audits.manage")

  const selectedId = Number(params.get("audit")) || null
  const setSelected = (id: number | null) => setParams((p) => { if (id) p.set("audit", String(id)); else p.delete("audit"); return p }, { replace: true })

  const del = useMutation({
    mutationFn: (id: number) => api.del(`/audits/programmes/${id}`),
    onSuccess: () => { toast.success("Programme deleted"); invalidateAudits(qc) },
    onError: (e: Error) => toast.error(e.message),
  })

  const filtered = useMemo(() => (audits.data ?? []).filter((a) =>
    (entity == null || a.entity_id === entity) && (status == null || a.status === status)
  ).sort((a, b) => b.planned_start.localeCompare(a.planned_start)), [audits.data, entity, status])

  if (progs.isLoading || audits.isLoading) return <Loading />
  if (progs.error) return <ErrorState error={progs.error} />
  if (audits.error) return <ErrorState error={audits.error} />

  return (
    <div className="space-y-5">
      <Section title="Audit programme" bodyClassName="p-0"
        actions={canManage && <Button size="sm" onClick={() => setCreatingProg(true)}><Plus /> New programme</Button>}>
        {!progs.data?.length ? <Empty className="p-6" icon={<ClipboardList className="size-6" />} title="No audit programme yet">
          The yearly programme documents which audits are planned and why (ISO 9.2.2 a).
        </Empty> : (
          <ul className="divide-y">
            {progs.data.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12.5px] text-ink-3">{p.year}</span>
                    <span className="text-[13.5px] font-medium text-ink">{p.title}</span>
                  </div>
                  {p.scope && <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-2">{p.scope}</p>}
                  {p.approved_on && <p className="mt-1 text-[12px] text-ink-3">Approved {fmtDate(p.approved_on)}{p.approved_by ? ` by ${p.approved_by}` : ""}</p>}
                </div>
                {p.can_edit && (
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon-xs" variant="ghost" aria-label={`Edit ${p.title}`} onClick={() => setEditingProg(p)}><Pencil /></Button>
                    <Confirm title="Delete this programme?" description="Audits already linked to it must be removed or reassigned first."
                      onConfirm={() => del.mutateAsync(p.id)} trigger={<Button size="icon-xs" variant="ghost" aria-label={`Delete ${p.title}`}><Trash2 /></Button>} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="flex flex-wrap items-center gap-2">
        <EntityFilter value={entity} onChange={setEntity} className="w-60" />
        <OptionSelect className="w-44" value={status} onChange={setStatus} allowNone noneLabel="All statuses" placeholder="All statuses" options={AUDIT_STATUS} />
        {canManage && <Button className="ml-auto" onClick={() => setCreatingAudit(true)}><Plus /> New audit</Button>}
      </div>

      {!filtered.length ? (
        <Section><Empty title="No audits match" icon={<ClipboardList className="size-6" />} /></Section>
      ) : (
        <Section bodyClassName="p-0">
          <ul className="divide-y">
            {filtered.map((a) => (
              <li key={a.id} className="grid grid-cols-[90px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:grid-cols-[90px_minmax(0,1fr)_140px_120px_auto]">
                <span className="font-mono text-[12.5px] text-ink-3">{a.code}</span>
                <button className="min-w-0 text-left" onClick={() => setSelected(a.id)}>
                  <div className="flex items-center gap-2">
                    {a.entity ? <EntityTag code={a.entity.code} name={a.entity.name} /> : <GroupPill />}
                    <span className="truncate text-[13px] font-medium text-ink hover:text-petrol">{a.scope}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-ink-3">
                    <span>{AUDIT_TYPE_LABEL[a.type]}</span>
                    {a.lead_auditor_name && <span>Lead: {a.lead_auditor_name}</span>}
                  </div>
                </button>
                <span className="hidden text-[12.5px] text-ink-2 md:block">{fmtDate(a.planned_start)} – {fmtDate(a.planned_end)}</span>
                <span className="hidden md:block"><AuditStatusPill status={a.status} /></span>
                <span className="flex items-center justify-end gap-1">
                  {a.has_open_findings && <span className="text-[11.5px] text-alarm">Open findings</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <ProgrammeDialog open={creatingProg || editingProg != null} onOpenChange={(o) => { if (!o) { setCreatingProg(false); setEditingProg(null) } }} programme={editingProg} />
      <AuditDialog open={creatingAudit || editingAudit != null} onOpenChange={(o) => { if (!o) { setCreatingAudit(false); setEditingAudit(null) } }}
        audit={editingAudit} defaultEntity={entity} programmes={progs.data ?? []} />
      <AuditSheet auditId={selectedId} onClose={() => setSelected(null)} onEdit={(a) => setEditingAudit(a)} />
    </div>
  )
}

