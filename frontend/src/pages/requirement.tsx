import { useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bot, ChevronLeft, ChevronRight, Pencil } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, EntityTag, ErrorState, Loading, PageHeader, Pill, PriorityPill, ScoreChip, Section, StatusPill } from "@/components/common/basics"
import { CommentsPanel, DocumentLinks, Markdown } from "@/components/common/collab"
import { Field } from "@/components/common/fields"
import { AddProvisionDialog, ProvisionList } from "@/components/assess/provisions"
import { CorePill, IdeTiles, ScopePill, useRequirements, type RequirementDetailResp } from "@/components/assess/shared"
import { RequirementLegalSection } from "@/components/governance/legal"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate, fromNow, pct } from "@/lib/format"
import type { Requirement } from "@/lib/types"

function EditRequirementDialog({ r, onSaved }: { r: Requirement; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(r)
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {}
      for (const k of ["section", "text", "check_points", "legal_reference", "iso_reference", "is_core"] as const) {
        const v = typeof form[k] === "string" ? ((form[k] as string).trim() || null) : form[k]
        if (v !== r[k]) body[k] = v
      }
      return Object.keys(body).length ? api.patch(`/requirements/${r.id}`, body) : Promise.resolve(null)
    },
    onSuccess: (res) => { if (res) { toast.success("Requirement saved"); onSaved() } setOpen(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setForm(r) }}>
      <DialogTrigger asChild><Button variant="outline"><Pencil /> Edit requirement</Button></DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit requirement {r.number}</DialogTitle>
          <DialogDescription>Changes apply to all entities and rounds. Every change is recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto scroll-thin pr-1">
          <Field label="Section" className="col-span-2" htmlFor="rq-section"><Input id="rq-section" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} /></Field>
          <Field label="Requirement text" className="col-span-2" htmlFor="rq-text"><Textarea id="rq-text" rows={3} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></Field>
          <Field label="Check points" className="col-span-2" htmlFor="rq-cp"><Textarea id="rq-cp" rows={6} value={form.check_points ?? ""} onChange={(e) => setForm({ ...form, check_points: e.target.value })} /></Field>
          <Field label="National legal reference" htmlFor="rq-legal"><Input id="rq-legal" value={form.legal_reference ?? ""} onChange={(e) => setForm({ ...form, legal_reference: e.target.value })} placeholder="§ 30 Abs. 2 Nr. 1 BSIG" /></Field>
          <Field label="ISO/IEC 27001 reference" htmlFor="rq-iso"><Input id="rq-iso" value={form.iso_reference ?? ""} onChange={(e) => setForm({ ...form, iso_reference: e.target.value })} placeholder="5.2, A.5.1" /></Field>
          <label className="col-span-2 flex items-center justify-between rounded-md border bg-surface px-3 py-2">
            <span>
              <span className="block text-[13px] font-medium text-ink">Core requirement</span>
              <span className="block text-[12px] text-ink-3">Core requirements are prioritised in the assessment and on the dashboard.</span>
            </span>
            <Switch checked={form.is_core} onCheckedChange={(v) => setForm({ ...form, is_core: v })} aria-label="Core requirement" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!form.section.trim() || !form.text.trim() || save.isPending} onClick={() => save.mutate()}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Guidance({ r, canEdit, onSaved }: { r: Requirement; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(r.guidance ?? "")
  const save = useMutation({
    mutationFn: () => api.patch(`/requirements/${r.id}`, { guidance: value.trim() || null }),
    onSuccess: () => { toast.success("Guidance saved"); setEditing(false); onSaved() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Section title="Assessor guidance" actions={canEdit && !editing ? (
      <Button size="xs" variant="ghost" onClick={() => { setValue(r.guidance ?? ""); setEditing(true) }}><Pencil /> Edit guidance</Button>
    ) : undefined}>
      {editing ? (
        <div className="space-y-2">
          <Textarea autoFocus rows={8} value={value} onChange={(e) => setValue(e.target.value)} className="font-mono text-[12.5px]"
            placeholder="How to assess this requirement, typical evidence, common gaps. Markdown is supported." />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save guidance</Button>
          </div>
        </div>
      ) : r.guidance ? <Markdown className="prose-md text-[13.5px]">{r.guidance}</Markdown> : (
        <p className="text-[13px] text-ink-3">{canEdit ? "No guidance yet. Add hints on typical evidence and common gaps for assessors." : "No guidance has been written for this requirement."}</p>
      )}
    </Section>
  )
}

export default function RequirementPage() {
  const { id } = useParams()
  const reqId = Number(id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { canAny, canGlobal } = useAuth()
  const q = useQuery({ queryKey: ["requirement", reqId], queryFn: () => api.get<RequirementDetailResp>(`/requirements/${reqId}`), enabled: !!reqId })
  const all = useRequirements()
  const nav = useMemo(() => {
    const list = all.data ?? []
    const i = list.findIndex((r) => r.id === reqId)
    return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null }
  }, [all.data, reqId])
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["requirement", reqId] })
    qc.invalidateQueries({ queryKey: ["requirements"] })
  }

  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <div><ErrorState error={q.error ?? "Requirement not found"} /><Link to="/catalog" className="mt-3 inline-block text-[13px] text-petrol hover:underline">Back to the catalogue</Link></div>
  const { requirement: r, chapter, provisions, answers, action_items, documents } = q.data
  const sectionTitle = r.section.replace(/^[\d.]+\s*/, "")
  const canCatalog = canGlobal("catalog.manage")
  const canRegs = canGlobal("regulations.manage")

  const ask = () => {
    const question = `Did we already answer requirement ${r.number} for other entities, and which documents cover it?`
    navigate(`/assistant?q=${encodeURIComponent(question)}`, { state: { context: { type: "requirement", id: r.id, label: `${r.number} ${sectionTitle}` } } })
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-3">
        <Link to="/catalog" className="hover:text-petrol">Catalogue</Link>
        <span aria-hidden>/</span>
        <Link to={`/catalog?chapter=${chapter.number}`} className="hover:text-petrol">Chapter {chapter.number}: {chapter.title}</Link>
      </div>
      <PageHeader
        title={<span className="flex items-baseline gap-3"><Code className="text-[20px] font-medium text-ink">{r.number}</Code>{sectionTitle}</span>}
        actions={
          <>
            <Button variant="outline" size="icon" disabled={!nav.prev} aria-label={nav.prev ? `Previous requirement ${nav.prev.number}` : "No previous requirement"}
              onClick={() => nav.prev && navigate(`/catalog/${nav.prev.id}`)}><ChevronLeft /></Button>
            <Button variant="outline" size="icon" disabled={!nav.next} aria-label={nav.next ? `Next requirement ${nav.next.number}` : "No next requirement"}
              onClick={() => nav.next && navigate(`/catalog/${nav.next.id}`)}><ChevronRight /></Button>
            {canAny("ai.use") && <Button variant="outline" onClick={ask}><Bot /> Ask assistant</Button>}
            {canCatalog && <EditRequirementDialog r={r} onSaved={refresh} />}
          </>
        }>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {r.is_core && <CorePill />}
          <Pill tone="brass" title="Chapter target">Chapter target {pct(chapter.target)}</Pill>
          <Pill tone="outline">{chapter.source}</Pill>
        </div>
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <Section title="Requirement">
            <p className="text-[14px] leading-relaxed text-ink">{r.text}</p>
            {r.check_points && (
              <div className="mt-3 border-t pt-3">
                <div className="mb-1 text-[12.5px] font-medium text-ink-2">Check points</div>
                <div className="prose-law text-[13px]">{r.check_points}</div>
              </div>
            )}
            {(r.legal_reference || r.iso_reference) && (
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t pt-3 text-[12.5px]">
                {r.legal_reference && <span><span className="text-ink-3">National reference </span><Code>{r.legal_reference}</Code></span>}
                {r.iso_reference && <span><span className="text-ink-3">ISO/IEC 27001:2022 </span><Code>{r.iso_reference}</Code></span>}
              </div>
            )}
          </Section>
          <Guidance key={r.guidance ?? ""} r={r} canEdit={canCatalog} onSaved={refresh} />
        </div>

        <div className="space-y-5">
          <RequirementLegalSection requirementId={r.id} />
          <Section title={`Legal references (${provisions.length})`} actions={canRegs ? <AddProvisionDialog requirementId={r.id} onDone={refresh} /> : undefined}>
            {canAny("regulations.read") ? <ProvisionList provisions={provisions} canManage={canRegs} onRemoved={refresh} />
              : <p className="text-[13px] text-ink-3">You do not have access to the regulations library.</p>}
          </Section>
        </div>
      </div>

      {canAny("assessments.read") && (
        <Section title="Answers by entity in the current round" className="mt-5" bodyClassName="p-3">
          {answers.length === 0 ? <Empty title="No answers you can see">This requirement has not been assessed for an entity you have access to.</Empty> : (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
              {answers.map((a) => (
                <div key={a.answer_id} className="flex flex-col rounded-md border bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <EntityTag code={a.entity.code} name={a.entity.name} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.entity.name}</span>
                    <ScoreChip value={a.score} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <IdeTiles row={a} />
                    <ScopePill scope={a.scope} />
                    {a.finding_id && <Code className="text-[11.5px] text-alarm">{a.finding_id}</Code>}
                  </div>
                  <dl className="mt-2 flex-1 space-y-1.5 text-[12.5px]">
                    <AnsField label="Evidence" v={a.evidence} />
                    <AnsField label="Gap" v={a.gap_description} />
                    <AnsField label="Recommended action" v={a.recommended_action} />
                    <AnsField label="Responsible" v={a.responsible} />
                  </dl>
                  <div className="mt-2 flex items-center justify-between border-t pt-2 text-[12px] text-ink-3">
                    <span>Updated {fromNow(a.updated_at)}</span>
                    <Link to={`/assessments/${a.assessment_id}?req=${r.id}`} className="font-medium text-petrol hover:underline">Open answer</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          {canAny("findings.read") && (
            <Section title="Action plan items" bodyClassName="p-0">
              {action_items.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-3">No action plan item for this requirement. Findings are added from the assessment or the action plan.</p> : (
                <ul>
                  {action_items.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 border-b px-4 py-2 text-[13px] last:border-0">
                      <Code className="w-14">{i.code}</Code>
                      <EntityTag code={i.entity_code} />
                      <Link to={`/action-plan?item=${i.id}`} className="min-w-0 flex-1 truncate hover:text-petrol">{i.title}</Link>
                      <PriorityPill value={i.priority} />
                      <span className="tabular w-24 text-right text-[12.5px] text-ink-3">{fmtDate(i.target_date)}</span>
                      <StatusPill value={i.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
          {canAny("documents.read") && (
            <Section title="Linked documents">
              <DocumentLinks targetType="requirement" targetId={r.id} documents={documents} canEdit={canAny("assessments.edit")}
                onChange={() => qc.invalidateQueries({ queryKey: ["requirement", reqId] })} />
            </Section>
          )}
        </div>
        <Section title="Comments">
          <CommentsPanel targetType="requirement" targetId={r.id} canComment={canAny("assessments.edit")} />
        </Section>
      </div>
    </div>
  )
}

function AnsField({ label, v }: { label: string; v: string | null }) {
  if (!v) return null
  return (
    <div>
      <dt className="text-[11.5px] text-ink-3">{label}</dt>
      <dd className="line-clamp-4 text-ink-2">{v}</dd>
    </div>
  )
}
