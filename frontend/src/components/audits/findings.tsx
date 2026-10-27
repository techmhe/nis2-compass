import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, ClipboardPlus, ListChecks, Search, X } from "lucide-react"
import { toast } from "sonner"
import { RequirementPicker } from "@/components/controls/requirement-picker"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, EntityTag, ErrorState, Loading, Section } from "@/components/common/basics"
import { EntitySelect, Field, OptionSelect } from "@/components/common/fields"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { fmtDate } from "@/lib/format"
import { EntityFilter, FindingStatusPill, FindingTypePill, GroupPill, auditKeys, findingDue, invalidateAudits, useAllFindings } from "./shared"
import { FINDING_TYPES, type AuditFinding } from "./types"

/* ---------- create finding ---------- */

interface FindingForm { type: string; description: string; requirement_id: number | null; entity_id: number | null; due_date: string }
const emptyFinding = (entityId: number | null): FindingForm => ({ type: "observation", description: "", requirement_id: null, entity_id: entityId, due_date: "" })

export function FindingDialog({ open, onOpenChange, auditId, defaultEntity }: {
  open: boolean; onOpenChange: (o: boolean) => void; auditId: number; defaultEntity: number | null
}) {
  const qc = useQueryClient()
  const [f, setF] = useState<FindingForm>(emptyFinding(defaultEntity))
  useEffect(() => { if (open) setF(emptyFinding(defaultEntity)) }, [open, defaultEntity])
  const set = <K extends keyof FindingForm>(k: K, v: FindingForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const valid = f.description.trim().length > 0
  const save = useMutation({
    mutationFn: () => {
      const body = { type: f.type, description: f.description.trim(), requirement_id: f.requirement_id, entity_id: f.entity_id, due_date: f.due_date || null }
      return api.post<AuditFinding>(`/audits/audits/${auditId}/findings`, body)
    },
    onSuccess: (fnd) => { toast.success(`Finding ${fnd.number} recorded`); invalidateAudits(qc); qc.invalidateQueries({ queryKey: auditKeys.audit(auditId) }); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>New finding</DialogTitle>
          <DialogDescription>Major/minor nonconformity, observation or opportunity for improvement.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><OptionSelect value={f.type} onChange={(v) => set("type", v ?? "observation")} options={FINDING_TYPES} /></Field>
          <Field label="Entity" hint="Leave empty to inherit the audit's entity"><EntitySelect value={f.entity_id} onChange={(v) => set("entity_id", v)} groupLabel="Same as audit / group-wide" /></Field>
          <Field label="Requirement" className="col-span-2"><RequirementPicker value={f.requirement_id ? [f.requirement_id] : []} onChange={(ids) => set("requirement_id", ids[0] ?? null)} single /></Field>
          <Field label="Due date" htmlFor="f-due"><Input id="f-due" type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} /></Field>
          <Field label="Description" className="col-span-2" htmlFor="f-desc"><Textarea id="f-desc" rows={4} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>Add finding</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- create action item ---------- */

function CreateActionItemDialog({ finding, onOpenChange }: { finding: AuditFinding | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState("")
  const [reqId, setReqId] = useState<number | null>(null)
  useEffect(() => { if (finding) { setTitle(""); setReqId(finding.requirement_id) } }, [finding])
  const needsReq = finding != null && !finding.requirement_id
  const valid = !needsReq || reqId != null
  const save = useMutation({
    mutationFn: () => api.post(`/audits/findings/${finding!.id}/create-action-item`, { title: title.trim() || null, requirement_id: needsReq ? reqId : undefined }),
    onSuccess: () => { toast.success("Action plan item created"); invalidateAudits(qc); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={finding != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create action plan item</DialogTitle>
          <DialogDescription>Pre-filled from finding {finding?.audit_code} {finding?.number}.</DialogDescription>
        </DialogHeader>
        {needsReq && (
          <Field label="Requirement" hint="This finding has no linked requirement; choose one for the action plan item">
            <RequirementPicker value={reqId ? [reqId] : []} onChange={(ids) => setReqId(ids[0] ?? null)} single />
          </Field>
        )}
        <Field label="Title" hint="Leave empty to use a default title referencing the finding" htmlFor="ai-title">
          <Input id="ai-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}><ClipboardPlus /> Create action item</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- close finding ---------- */

function CloseFindingDialog({ finding, onOpenChange }: { finding: AuditFinding | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [note, setNote] = useState("")
  useEffect(() => { if (finding) setNote("") }, [finding])
  const actionCompleted = false // the action item's status is not loaded here; the server enforces the rule
  const save = useMutation({
    mutationFn: () => api.post(`/audits/findings/${finding!.id}/close`, { closure_note: note.trim() || null }),
    onSuccess: () => { toast.success("Finding closed"); invalidateAudits(qc); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={finding != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close finding {finding?.audit_code} {finding?.number}</DialogTitle>
          <DialogDescription>Closing requires either a completed linked action plan item or a closure note explaining why.</DialogDescription>
        </DialogHeader>
        <Field label="Closure note" hint={finding?.action_item_id && !actionCompleted ? "Required unless the linked action plan item is completed" : undefined} htmlFor="cl-note">
          <Textarea id="cl-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}><CheckCircle2 /> Close finding</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- row ---------- */

export function FindingRow({ finding: f, showAudit, highlight }: { finding: AuditFinding; showAudit: boolean; highlight?: boolean }) {
  const qc = useQueryClient()
  const [creatingAction, setCreatingAction] = useState<AuditFinding | null>(null)
  const [closing, setClosing] = useState<AuditFinding | null>(null)
  const reopen = useMutation({
    mutationFn: (id: number) => api.post(`/audits/findings/${id}/reopen`, {}),
    onSuccess: () => { toast.success("Finding reopened"); invalidateAudits(qc) },
    onError: (e: Error) => toast.error(e.message),
  })
  const due = findingDue(f)
  return (
    <li id={`finding-${f.id}`} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3", highlight && "bg-petrol-50/60")}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {f.entity ? <EntityTag code={f.entity.code} name={f.entity.name} /> : <GroupPill />}
          <FindingTypePill type={f.type} />
          <FindingStatusPill status={f.status} />
          {due === "overdue" && <span className="text-[11.5px] font-medium text-alarm">overdue</span>}
          {due === "due_soon" && <span className="text-[11.5px] font-medium text-amber">due soon</span>}
        </div>
        <p className="mt-1 text-[13px] text-ink">
          {showAudit && <Link to={`/audits/programme?audit=${f.audit_id}`} className="mr-1 font-mono text-[11.5px] text-ink-3 hover:text-petrol">{f.audit_code} {f.number}</Link>}
          {!showAudit && <span className="mr-1 font-mono text-[11.5px] text-ink-3">{f.number}</span>}
          {f.description}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-ink-3">
          {f.requirement && <Code className="text-[11.5px]">{f.requirement.number}</Code>}
          {f.due_date && <span>Due {fmtDate(f.due_date)}</span>}
          {f.closed_at && <span>Closed {fmtDate(f.closed_at)}{f.closed_by ? ` by ${f.closed_by}` : ""}</span>}
        </div>
        {f.closure_note && <p className="mt-1 text-[12.5px] text-ink-2">{f.closure_note}</p>}
      </div>
      {f.can_edit && (
        <div className="flex shrink-0 flex-col items-end gap-1">
          {f.status !== "closed" && !f.action_item_id && (
            <Button size="xs" variant="outline" onClick={() => setCreatingAction(f)}><ClipboardPlus /> Action item</Button>
          )}
          {f.status !== "closed" && (
            <Button size="xs" variant="outline" onClick={() => setClosing(f)}><CheckCircle2 /> Close</Button>
          )}
          {f.status === "closed" && (
            <Button size="xs" variant="ghost" disabled={reopen.isPending} onClick={() => reopen.mutate(f.id)}>Reopen</Button>
          )}
        </div>
      )}
      <CreateActionItemDialog finding={creatingAction} onOpenChange={(o) => !o && setCreatingAction(null)} />
      <CloseFindingDialog finding={closing} onOpenChange={(o) => !o && setClosing(null)} />
    </li>
  )
}

/* ---------- main view ---------- */

export function FindingsView() {
  const [entity, setEntity] = useState<number | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [type, setType] = useState<string | null>(null)
  const [text, setText] = useState("")
  const q = useAllFindings()
  const [params] = useSearchParams()
  const linked = Number(params.get("finding")) || null  // deep link from search, My work, reminders and checks
  useEffect(() => {
    if (linked && q.data) document.getElementById(`finding-${linked}`)?.scrollIntoView({ block: "center" })
  }, [linked, q.data])

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState error={q.error} />

  const rows = (q.data ?? []).filter((f) => {
    if (entity != null && f.entity_id !== entity && f.entity?.id !== entity) return false
    if (status != null && f.status !== status) return false
    if (type != null && f.type !== type) return false
    const s = text.trim().toLowerCase()
    if (s && !`${f.description} ${f.audit_code} ${f.number}`.toLowerCase().includes(s)) return false
    return true
  })
  const STATUS_OPTS = [{ value: "open", label: "Open" }, { value: "action_planned", label: "Action planned" }, { value: "closed", label: "Closed" }]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <EntityFilter value={entity} onChange={setEntity} className="w-60" />
        <OptionSelect className="w-44" value={status} onChange={setStatus} allowNone noneLabel="All statuses" placeholder="All statuses" options={STATUS_OPTS} />
        <OptionSelect className="w-52" value={type} onChange={setType} allowNone noneLabel="All types" placeholder="All types" options={FINDING_TYPES} />
        <div className="relative w-64">
          <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Description or audit code" className="pl-8" aria-label="Search findings" />
          {text && <button className="absolute top-2.5 right-2.5 text-ink-3 hover:text-ink" onClick={() => setText("")} aria-label="Clear search"><X className="size-4" /></button>}
        </div>
      </div>
      {!rows.length ? (
        <Section><Empty icon={<ListChecks className="size-6" />} title="No findings match" /></Section>
      ) : (
        <Section bodyClassName="p-0"><ul className="divide-y">{rows.map((f) => <FindingRow key={f.id} finding={f} showAudit highlight={f.id === linked} />)}</ul></Section>
      )}
    </div>
  )
}
