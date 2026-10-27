import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Gavel, Pencil, Plus, Trash2, UserPlus, Users, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, EntityTag, ErrorState, Loading, Pill, Section } from "@/components/common/basics"
import { CommentsPanel, Confirm, DocumentLinks } from "@/components/common/collab"
import { EntitySelect, Field, OptionSelect, UserSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate, isoDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { DueDate, EntityFilter, govKeys, Meta, TrainingPill } from "./shared"
import {
  DECISION_LABEL, DECISION_TYPES,
  type BoardDecision, type BoardMember, type LinkedRef, type MatrixEntity, type Obligation,
} from "./types"

/* ---------- member dialog ---------- */

interface MemberForm { entity_id: number | null; name: string; function: string; user_id: number | null; email: string; appointed_at: string; left_at: string; notes: string }
const emptyMember = (entityId: number | null): MemberForm => ({ entity_id: entityId, name: "", function: "", user_id: null, email: "", appointed_at: "", left_at: "", notes: "" })
const toMemberForm = (m: BoardMember): MemberForm => ({
  entity_id: m.entity_id, name: m.name, function: m.function ?? "", user_id: m.user_id, email: m.email ?? "",
  appointed_at: m.appointed_at ?? "", left_at: m.left_at ?? "", notes: m.notes ?? "",
})

function MemberDialog({ open, onOpenChange, member, defaultEntity }: { open: boolean; onOpenChange: (o: boolean) => void; member: BoardMember | null; defaultEntity: number | null }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const [f, setF] = useState<MemberForm>(emptyMember(defaultEntity))
  useEffect(() => { if (open) setF(member ? toMemberForm(member) : emptyMember(defaultEntity)) }, [open, member, defaultEntity])
  const set = <K extends keyof MemberForm>(k: K, v: MemberForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const valid = f.entity_id != null && f.name.trim() && can("governance.manage", f.entity_id) && (!f.left_at || !f.appointed_at || f.left_at >= f.appointed_at)
  const save = useMutation({
    mutationFn: () => {
      const body = { entity_id: f.entity_id, name: f.name.trim(), function: f.function.trim() || null, user_id: f.user_id, email: f.email.trim() || null,
        appointed_at: f.appointed_at || null, left_at: f.left_at || null, notes: f.notes.trim() || null }
      return member ? api.put<BoardMember>(`/governance/board-members/${member.id}`, body) : api.post<BoardMember>("/governance/board-members", body)
    },
    onSuccess: (m) => {
      toast.success(member ? "Member saved" : m.training.deadline ? `${m.name} added. Training due by ${fmtDate(m.training.deadline)}` : `${m.name} added`)
      qc.invalidateQueries({ queryKey: govKeys.all })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{member ? "Edit management body member" : "Add management body member"}</DialogTitle>
          <DialogDescription>New members receive a training obligation with the deadline of the applicable training rule.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entity"><EntitySelect value={f.entity_id} onChange={(v) => set("entity_id", v)} allowGroup={false} /></Field>
          <Field label="Name" htmlFor="bm-name"><Input id="bm-name" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Function" htmlFor="bm-fn"><Input id="bm-fn" value={f.function} onChange={(e) => set("function", e.target.value)} placeholder="Managing director" /></Field>
          <Field label="E-mail" htmlFor="bm-mail"><Input id="bm-mail" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Appointed on" htmlFor="bm-app"><Input id="bm-app" type="date" value={f.appointed_at} onChange={(e) => set("appointed_at", e.target.value)} /></Field>
          <Field label="Left on" hint="Leave empty while in office" htmlFor="bm-left"><Input id="bm-left" type="date" value={f.left_at} onChange={(e) => set("left_at", e.target.value)} /></Field>
          <Field label="User account" hint="Links the training obligation to My work" className="col-span-2"><UserSelect value={f.user_id} onChange={(v) => set("user_id", v)} placeholder="No user account" /></Field>
          <Field label="Notes" className="col-span-2" htmlFor="bm-notes"><Textarea id="bm-notes" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{member ? "Save changes" : "Add member"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- decision dialog ---------- */

interface DecisionForm { entity_id: number | null; decided_on: string; decision_type: string; subject: string; description: string; participants: string; linked: LinkedRef[]; complete_obligation_id: number | null }
const emptyDecision = (entityId: number | null): DecisionForm => ({ entity_id: entityId, decided_on: isoDate(new Date()), decision_type: "approve_measures", subject: "", description: "", participants: "", linked: [], complete_obligation_id: null })
const toDecisionForm = (d: BoardDecision): DecisionForm => ({ entity_id: d.entity_id, decided_on: d.decided_on, decision_type: d.decision_type, subject: d.subject, description: d.description ?? "", participants: d.participants ?? "", linked: d.linked, complete_obligation_id: null })

const FULFILS: Record<string, string[]> = {
  approve_measures: ["measures_approval"], approve_policy: ["policy_review"], oversight_review: ["oversight_review"],
  accept_risk: ["risk_review"], budget: [], other: [],
}

function DecisionDialog({ open, onOpenChange, decision, defaultEntity, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; decision: BoardDecision | null; defaultEntity: number | null; onSaved?: (d: BoardDecision) => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const [f, setF] = useState<DecisionForm>(emptyDecision(defaultEntity))
  const [linkLabel, setLinkLabel] = useState("")
  const [linkUrl, setLinkUrl] = useState("")
  useEffect(() => { if (open) { setF(decision ? toDecisionForm(decision) : emptyDecision(defaultEntity)); setLinkLabel(""); setLinkUrl("") } }, [open, decision, defaultEntity])
  const set = <K extends keyof DecisionForm>(k: K, v: DecisionForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const obs = useQuery({ queryKey: govKeys.obligations, queryFn: () => api.get<Obligation[]>("/governance/obligations"), enabled: open })
  const candidates = (obs.data ?? []).filter((o) => o.status === "open" && o.entity_id === f.entity_id && (FULFILS[f.decision_type] ?? []).includes(o.kind))
  const valid = f.entity_id != null && f.subject.trim() && f.decided_on && can("governance.manage", f.entity_id)
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, subject: f.subject.trim(), description: f.description.trim() || null, participants: f.participants.trim() || null }
      return decision ? api.put<BoardDecision>(`/governance/decisions/${decision.id}`, body) : api.post<BoardDecision>("/governance/decisions", body)
    },
    onSuccess: (d) => { toast.success(decision ? `${d.code} saved` : `Decision ${d.code} recorded`); qc.invalidateQueries({ queryKey: govKeys.all }); onOpenChange(false); onSaved?.(d) },
    onError: (e: Error) => toast.error(e.message),
  })
  const addLink = () => {
    if (!linkLabel.trim()) return
    const url = linkUrl.trim()
    if (url && !/^\/([^/\\\s][^\s\\]*)?$/.test(url)) { toast.error("Links must be a path inside NIS2 Compass, for example /risks/4"); return }
    set("linked", [...f.linked, { type: "link", id: null, label: linkLabel.trim(), url: url || null }])
    setLinkLabel(""); setLinkUrl("")
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{decision ? `Edit decision ${decision.code}` : "Record management body decision"}</DialogTitle>
          <DialogDescription>Approvals, risk acceptances, budgets and oversight reviews. Attach the minutes after saving.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto scroll-thin pr-1">
          <Field label="Entity"><EntitySelect value={f.entity_id} onChange={(v) => { set("entity_id", v); set("complete_obligation_id", null) }} allowGroup={false} /></Field>
          <Field label="Decided on" htmlFor="bd-date"><Input id="bd-date" type="date" value={f.decided_on} onChange={(e) => set("decided_on", e.target.value)} /></Field>
          <Field label="Type" className="col-span-2"><OptionSelect value={f.decision_type} onChange={(v) => { set("decision_type", v ?? "other"); set("complete_obligation_id", null) }} options={DECISION_TYPES} /></Field>
          <Field label="Subject" className="col-span-2" htmlFor="bd-subj"><Input id="bd-subj" value={f.subject} onChange={(e) => set("subject", e.target.value)} /></Field>
          <Field label="Decision and conditions" className="col-span-2" htmlFor="bd-desc"><Textarea id="bd-desc" rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label="Participants" className="col-span-2" htmlFor="bd-part"><Input id="bd-part" value={f.participants} onChange={(e) => set("participants", e.target.value)} placeholder="Names and roles" /></Field>
          {candidates.length > 0 && (
            <Field label="Fulfils obligation" hint="Completes the selected obligation and schedules its next occurrence" className="col-span-2">
              <OptionSelect value={f.complete_obligation_id ? String(f.complete_obligation_id) : null} onChange={(v) => set("complete_obligation_id", v ? Number(v) : null)}
                allowNone noneLabel="None" options={candidates.map((o) => ({ value: String(o.id), label: `${o.title} (due ${fmtDate(o.due_date)})` }))} />
            </Field>
          )}
          <div className="col-span-2 space-y-1.5">
            <Label className="text-[12.5px] font-medium text-ink-2">Linked objects</Label>
            {f.linked.length > 0 && (
              <ul className="space-y-1">
                {f.linked.map((l, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-md border px-2 py-1 text-[12.5px]">
                    <span className="min-w-0 flex-1 truncate">{l.label}</span>
                    {l.url && <Code className="truncate text-[11.5px] text-ink-3">{l.url}</Code>}
                    <Button size="icon-xs" variant="ghost" aria-label={`Remove link ${l.label}`} onClick={() => set("linked", f.linked.filter((_, j) => j !== i))}><X /></Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Label, for example Risk RSK-004" aria-label="Linked object label" />
              <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="/risks/4" aria-label="Linked object path" className="w-40 font-mono text-[12.5px]" />
              <Button variant="outline" onClick={addLink} disabled={!linkLabel.trim()}>Add link</Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{decision ? "Save changes" : "Record decision"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- decision sheet ---------- */

function DecisionSheet({ id, onClose, onEdit }: { id: number | null; onClose: () => void; onEdit: (d: BoardDecision) => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: govKeys.decision(id ?? 0), queryFn: () => api.get<BoardDecision>(`/governance/decisions/${id}`), enabled: id != null })
  const del = useMutation({
    mutationFn: () => api.del(`/governance/decisions/${id}`),
    onSuccess: () => { toast.success("Decision deleted"); qc.invalidateQueries({ queryKey: govKeys.all }); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  const d = q.data
  return (
    <Sheet open={id != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[600px]">
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} className="m-5" /> : d && (
          <>
            <SheetHeader className="border-b px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Code>{d.code}</Code>
                <EntityTag code={d.entity.code} name={d.entity.name} />
                <Pill tone={d.decision_type === "accept_risk" ? "amber" : "petrol"}>{DECISION_LABEL[d.decision_type] ?? d.decision_type}</Pill>
              </div>
              <SheetTitle className="text-[16px]">{d.subject}</SheetTitle>
              <SheetDescription>Decided on {fmtDate(d.decided_on)}{d.created_by ? `, recorded by ${d.created_by}` : ""}</SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-5 py-4">
              {d.can_edit && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(d)}><Pencil /> Edit</Button>
                  <Confirm title={`Delete decision ${d.code}?`} description="Linked minutes stay in the document library." onConfirm={() => del.mutateAsync()}
                    trigger={<Button size="sm" variant="ghost" className="text-alarm"><Trash2 /> Delete</Button>} />
                </div>
              )}
              {d.description && <p className="text-[13.5px] whitespace-pre-wrap text-ink">{d.description}</p>}
              <div className="grid grid-cols-2 gap-4">
                <Meta label="Participants">{d.participants}</Meta>
                <Meta label="Linked objects">{d.linked.length ? (
                  <ul className="space-y-0.5">{d.linked.map((l, i) => <li key={i}>{l.url ? <Link to={l.url} className="text-petrol hover:underline">{l.label}</Link> : l.label}</li>)}</ul>
                ) : null}</Meta>
              </div>
              <div>
                <h3 className="mb-2 text-[13px] font-semibold">Minutes and documents</h3>
                <DocumentLinks targetType="board_decision" targetId={d.id} documents={d.documents ?? []} entityId={d.entity_id} canEdit={d.can_edit}
                  onChange={() => qc.invalidateQueries({ queryKey: govKeys.decision(d.id) })} />
              </div>
              <div>
                <h3 className="mb-2 text-[13px] font-semibold">Comments</h3>
                <CommentsPanel targetType="board_decision" targetId={d.id} canComment={d.can_edit} />
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ---------- main view ---------- */

export function ManagementView() {
  const { canAny } = useAuth()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [entity, setEntity] = useState<number | null>(null)
  const [showFormer, setShowFormer] = useState(false)
  const [memberDlg, setMemberDlg] = useState<{ open: boolean; member: BoardMember | null }>({ open: false, member: null })
  const [decisionDlg, setDecisionDlg] = useState<{ open: boolean; decision: BoardDecision | null }>({ open: false, decision: null })
  const members = useQuery({ queryKey: govKeys.members, queryFn: () => api.get<BoardMember[]>("/governance/board-members") })
  const matrix = useQuery({ queryKey: govKeys.matrix, queryFn: () => api.get<MatrixEntity[]>("/governance/training-matrix") })
  const decisions = useQuery({ queryKey: govKeys.decisions, queryFn: () => api.get<BoardDecision[]>("/governance/decisions") })
  const canManage = canAny("governance.manage")
  const focusMember = Number(params.get("member")) || null
  const decisionId = Number(params.get("decision")) || null
  const setDecision = (id: number | null) => setParams((p) => { if (id) p.set("decision", String(id)); else p.delete("decision"); return p }, { replace: true })

  useEffect(() => {
    if (focusMember) document.getElementById(`member-${focusMember}`)?.scrollIntoView({ block: "center" })
  }, [focusMember, members.data])

  const delMember = useMutation({
    mutationFn: (id: number) => api.del(`/governance/board-members/${id}`),
    onSuccess: () => { toast.success("Member removed"); qc.invalidateQueries({ queryKey: govKeys.all }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const memberRows = useMemo(() => (members.data ?? []).filter((m) => (entity == null || m.entity_id === entity) && (showFormer || m.active)), [members.data, entity, showFormer])
  const matrixRows = (matrix.data ?? []).filter((e) => entity == null || e.entity.id === entity)
  const decisionRows = (decisions.data ?? []).filter((d) => entity == null || d.entity_id === entity)

  if (members.isLoading || matrix.isLoading) return <Loading />
  if (members.error || matrix.error) return <ErrorState error={members.error ?? matrix.error} />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <EntityFilter value={entity} onChange={setEntity} className="w-60" />
        {canManage && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setDecisionDlg({ open: true, decision: null })}><Gavel /> Record decision</Button>
            <Button onClick={() => setMemberDlg({ open: true, member: null })}><UserPlus /> Add member</Button>
          </div>
        )}
      </div>

      <Section title="Training status" bodyClassName="p-0"
        actions={<Link to="/governance/trainings" className="text-[12.5px] text-petrol hover:underline">Training records</Link>}>
        {matrixRows.every((e) => e.members.length === 0) ? (
          <Empty icon={<Users className="size-6" />} title="No management body members recorded">Add the managing directors or board members of each entity to track their NIS-2 training.</Empty>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="px-4 py-2 font-medium">Member</th>
                  <th className="px-3 py-2 font-medium">Appointed</th>
                  <th className="px-3 py-2 font-medium">Last qualifying training</th>
                  <th className="px-3 py-2 font-medium">Deadline</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {matrixRows.map((e) => (
                  <MatrixGroup key={e.entity.id} e={e} focus={focusMember} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`Members (${memberRows.length})`} bodyClassName="p-0"
        actions={<label className="flex items-center gap-2 text-[12.5px] text-ink-2"><Switch checked={showFormer} onCheckedChange={setShowFormer} aria-label="Show former members" /> Show former members</label>}>
        {memberRows.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-3">No members for this selection.</p> : (
          <ul>
            {memberRows.map((m) => (
              <li key={m.id} id={`member-${m.id}`} className={cn("grid grid-cols-[60px_minmax(0,1fr)_150px_120px_auto] items-center gap-3 border-b px-4 py-2 text-[13px] last:border-0", focusMember === m.id && "bg-petrol-50/60")}>
                <EntityTag code={m.entity.code} name={m.entity.name} />
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{m.name}</div>
                  <div className="truncate text-[12px] text-ink-3">{m.function ?? "No function recorded"}{m.user_name ? `, user ${m.user_name}` : ""}</div>
                </div>
                <span className="text-[12.5px] text-ink-2">{m.left_at && !m.active ? `Left ${fmtDate(m.left_at)}` : m.appointed_at ? `Since ${fmtDate(m.appointed_at)}` : "Appointment date missing"}</span>
                {m.active ? <TrainingPill status={m.training.status} /> : <Pill tone="outline">Former</Pill>}
                <span className="flex justify-end gap-1">
                  {m.can_edit && <Button size="icon-xs" variant="ghost" aria-label={`Edit ${m.name}`} onClick={() => setMemberDlg({ open: true, member: m })}><Pencil /></Button>}
                  {m.can_edit && (
                    <Confirm title={`Remove ${m.name}?`} description="Use this only for records created by mistake. For members who left, set the leaving date instead so the history is kept."
                      confirmLabel="Remove" onConfirm={() => delMember.mutateAsync(m.id)}
                      trigger={<Button size="icon-xs" variant="ghost" aria-label={`Remove ${m.name}`}><Trash2 /></Button>} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Decision log (${decisionRows.length})`} bodyClassName="p-0"
        actions={canManage ? <Button size="xs" variant="outline" onClick={() => setDecisionDlg({ open: true, decision: null })}><Plus /> Record decision</Button> : undefined}>
        {decisions.isLoading ? <Loading /> : decisions.error ? <ErrorState error={decisions.error} className="m-4" /> : decisionRows.length === 0 ? (
          <Empty icon={<Gavel className="size-6" />} title="No decisions recorded">Record approvals of measures and policies, risk acceptances and oversight reviews so they can be shown to the authority on request.</Empty>
        ) : (
          <ul>
            {decisionRows.map((d) => (
              <li key={d.id}>
                <button onClick={() => setDecision(d.id)} className="grid w-full grid-cols-[64px_100px_60px_minmax(0,1fr)_150px] items-center gap-3 border-b px-4 py-2 text-left text-[13px] last:border-0 hover:bg-muted/40">
                  <Code>{d.code}</Code>
                  <span className="tabular text-[12.5px] text-ink-2">{fmtDate(d.decided_on)}</span>
                  <EntityTag code={d.entity.code} name={d.entity.name} />
                  <span className="truncate text-ink">{d.subject}</span>
                  <Pill tone={d.decision_type === "accept_risk" ? "amber" : "outline"} className="justify-self-start">{DECISION_LABEL[d.decision_type] ?? d.decision_type}</Pill>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <MemberDialog open={memberDlg.open} member={memberDlg.member} defaultEntity={entity} onOpenChange={(o) => !o && setMemberDlg({ open: false, member: null })} />
      <DecisionDialog open={decisionDlg.open} decision={decisionDlg.decision} defaultEntity={entity}
        onOpenChange={(o) => !o && setDecisionDlg({ open: false, decision: null })} onSaved={(d) => setDecision(d.id)} />
      <DecisionSheet id={decisionId} onClose={() => setDecision(null)} onEdit={(d) => setDecisionDlg({ open: true, decision: d })} />
    </div>
  )
}

function MatrixGroup({ e, focus }: { e: MatrixEntity; focus: number | null }) {
  return (
    <>
      <tr className="border-b bg-muted/60">
        <td colSpan={5} className="px-4 py-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <EntityTag code={e.entity.code} name={e.entity.name} />
            <span className="font-medium text-ink-2">{e.entity.name}</span>
            {e.rule ? (
              <>
                <Pill tone={e.rule.is_statutory ? "petrol" : "brass"}>{e.rule.is_statutory ? "Statutory" : "Company rule"}</Pill>
                <span className="text-ink-3">{e.rule.label}</span>
                {e.rule.legal_ref && <Code className="text-[11.5px] text-ink-3">{e.rule.legal_ref}</Code>}
              </>
            ) : <span className="text-ink-3">No training rule for this country</span>}
          </div>
        </td>
      </tr>
      {e.members.length === 0 ? (
        <tr className="border-b"><td colSpan={5} className="px-4 py-2 text-[12.5px] text-ink-3">No active members recorded.</td></tr>
      ) : e.members.map((m) => (
        <tr key={m.member.id} className={cn("border-b last:border-0", focus === m.member.id && "bg-petrol-50/60")}>
          <td className="px-4 py-2">
            <div className="font-medium text-ink">{m.member.name}</div>
            <div className="text-[12px] text-ink-3">{m.member.function}</div>
          </td>
          <td className="tabular px-3 py-2 text-[12.5px] text-ink-2">{fmtDate(m.member.appointed_at)}</td>
          <td className="px-3 py-2 text-[12.5px]">
            {m.last_training ? (
              <span>{fmtDate(m.last_training)}{m.latest && <Link to={`/governance/trainings?training=${m.latest.id}`} className="block truncate text-[12px] text-petrol hover:underline">{m.latest.title}</Link>}</span>
            ) : m.last_any_training ? (
              <span className="text-ink-3">None qualifying{e.rule?.requires_certificate ? " (no certificate)" : ""}; last {fmtDate(m.last_any_training)}</span>
            ) : <span className="text-ink-3">None recorded</span>}
          </td>
          <td className="px-3 py-2">{m.deadline ? <DueDate date={m.deadline} done={m.status === "compliant"} /> : <span className="text-[12.5px] text-ink-3">{m.status === "compliant" ? "Met" : "–"}</span>}</td>
          <td className="px-3 py-2"><TrainingPill status={m.status} /></td>
        </tr>
      ))}
    </>
  )
}

