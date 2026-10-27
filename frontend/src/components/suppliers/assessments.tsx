import { useState, type ReactNode } from "react"
import { Link } from "react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ClipboardCheck, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, ErrorState, Pill, Section } from "@/components/common/basics"
import { Confirm } from "@/components/common/collab"
import { Field, OptionSelect, StakeholderSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { PRIORITY_VALUES } from "@/lib/constants"
import { fmtDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { type Assessment, type Finding, RatingPill, SeverityPill, type SupplierDetail, dueLabel, dueTone, supplierKey, useSupplierMeta } from "./shared"

export function AssessmentsTab({ supplier }: { supplier: SupplierDetail }) {
  const meta = useSupplierMeta()
  const qc = useQueryClient()
  const refresh = () => { qc.invalidateQueries({ queryKey: supplierKey(supplier.id) }); qc.invalidateQueries({ queryKey: ["suppliers", "list"] }) }
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/suppliers/assessments/${id}`),
    onSuccess: () => { toast.success("Assessment deleted"); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })
  const months = supplier.review_months[supplier.tier]
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-4 py-3 text-[13px]">
        <div>
          <span className="text-ink-2">Review cycle for the {meta.tiers[supplier.tier].toLowerCase()} tier: every {months} months. </span>
          <span className={cn("font-medium", dueTone(supplier.due_state))}>
            {supplier.next_due ? `Next review ${fmtDate(supplier.next_due)} (${dueLabel(supplier.due_state).toLowerCase()})` : dueLabel(supplier.due_state)}
          </span>
        </div>
        {supplier.can_edit && (
          <AssessmentDialog supplier={supplier} onSaved={refresh} trigger={<Button size="sm"><Plus /> Record assessment</Button>} />
        )}
      </div>
      {supplier.assessments.length === 0 ? (
        <Section>
          <Empty title="No assessments yet" icon={<ClipboardCheck className="size-6" />}>
            Send the questionnaire for this tier, review certificates or audit the supplier, then record the result here. Negative findings can be turned into action plan items.
          </Empty>
        </Section>
      ) : supplier.assessments.map((a) => (
        <Section key={a.id}
          title={<span className="flex flex-wrap items-center gap-2">{fmtDate(a.assessed_on)}<span className="font-normal text-ink-3">{meta.methods[a.method] ?? a.method}</span></span>}
          actions={supplier.can_edit && (
            <>
              <AssessmentDialog supplier={supplier} assessment={a} onSaved={refresh}
                trigger={<Button variant="ghost" size="icon-sm" aria-label="Edit assessment"><Pencil /></Button>} />
              <Confirm title="Delete this assessment?" description="Findings that already became action plan items stay in the action plan." confirmLabel="Delete assessment"
                onConfirm={() => del.mutate(a.id)} trigger={<Button variant="ghost" size="icon-sm" aria-label="Delete assessment"><Trash2 /></Button>} />
            </>
          )}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <span className="text-ink-3">Score <span className="tabular ml-1 font-semibold text-ink">{a.score != null ? `${Math.round(a.score)}%` : "–"}</span></span>
            <span className="flex items-center gap-1.5 text-ink-3">Rating <RatingPill rating={a.rating} /></span>
            <span className="text-ink-3">Next due <span className="tabular ml-1 text-ink-2">{fmtDate(a.next_due)}</span></span>
            {a.assessor && <span className="text-ink-3">Assessor <span className="ml-1 text-ink-2">{a.assessor}</span></span>}
            {a.template_version != null && <span className="text-ink-3">Questionnaire version {a.template_version}</span>}
          </div>
          {a.summary && <p className="mt-2 text-[13px] text-ink-2">{a.summary}</p>}
          <div className="mt-3">
            <div className="mb-1.5 text-[12.5px] font-medium text-ink-2">Findings</div>
            {a.findings.length === 0 ? <p className="text-[12.5px] text-ink-3">No findings recorded.</p> : (
              <ul className="space-y-1.5">
                {a.findings.map((f, i) => (
                  <li key={i} className="flex flex-wrap items-start gap-2 rounded-md border bg-surface px-3 py-2 text-[13px]">
                    <SeverityPill severity={f.severity} />
                    <span className="min-w-0 flex-1 text-ink">{f.text}</span>
                    {f.action_item_id ? (
                      <Link to={`/action-plan?item=${f.action_item_id}`} className="text-[12.5px] text-petrol hover:underline">
                        Action item <Code className="text-petrol">{f.action_item_code ?? `#${f.action_item_id}`}</Code>
                      </Link>
                    ) : supplier.can_edit && (
                      <FindingActionDialog supplier={supplier} assessment={a} index={i} finding={f} onSaved={refresh} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {a.answers.length > 0 && <AnswersTable answers={a.answers} />}
        </Section>
      ))}
    </div>
  )
}

function AnswersTable({ answers }: { answers: Assessment["answers"] }) {
  const [open, setOpen] = useState(false)
  const tone = (v: string | null) => v === "Yes" ? "sage" : v === "Partial" ? "amber" : v === "No" ? "alarm" : "outline"
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
      <CollapsibleTrigger className="inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-petrol">
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        {open ? "Hide questionnaire answers" : `Show questionnaire answers (${answers.filter((x) => x.answer).length} of ${answers.length} answered)`}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 overflow-hidden rounded-md border">
          <table className="w-full text-[12.5px]">
            <tbody>
              {answers.map((x) => (
                <tr key={x.id} className="border-b align-top last:border-0">
                  <td className="w-12 px-3 py-1.5"><Code>{x.id}</Code></td>
                  <td className="px-2 py-1.5 text-ink-2">{x.question}{x.comment && <div className="mt-0.5 text-ink-3">{x.comment}</div>}</td>
                  <td className="w-24 px-3 py-1.5 text-right"><Pill tone={tone(x.answer)}>{x.answer ?? "No answer"}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function AssessmentDialog({ supplier, assessment, trigger, onSaved }: { supplier: SupplierDetail; assessment?: Assessment; trigger: ReactNode; onSaved: () => void }) {
  const meta = useSupplierMeta()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState("")
  const [method, setMethod] = useState<string | null>("certificate_review")
  const [score, setScore] = useState("")
  const [rating, setRating] = useState<string | null>(null)
  const [summary, setSummary] = useState("")
  const [nextDue, setNextDue] = useState("")
  const [findings, setFindings] = useState<Finding[]>([])
  const [error, setError] = useState<string | null>(null)
  const reset = () => {
    setDate(assessment?.assessed_on ?? new Date().toISOString().slice(0, 10))
    setMethod(assessment?.method ?? "certificate_review"); setScore(assessment?.score != null ? String(assessment.score) : "")
    setRating(assessment?.rating ?? null); setSummary(assessment?.summary ?? ""); setNextDue(assessment?.next_due ?? "")
    setFindings(assessment?.findings.map((f) => ({ ...f })) ?? []); setError(null)
  }
  const scoreNum = score.trim() === "" ? null : Number(score)
  const scoreOk = scoreNum == null || (!Number.isNaN(scoreNum) && scoreNum >= 0 && scoreNum <= 100)
  const save = useMutation({
    mutationFn: () => {
      const body = {
        assessed_on: date, method, score: scoreNum, rating, summary: summary.trim() || null, next_due: nextDue || null,
        findings: findings.filter((f) => f.text.trim()).map((f) => ({ ...f, text: f.text.trim() })),
      }
      return assessment ? api.put(`/suppliers/assessments/${assessment.id}`, body) : api.post(`/suppliers/${supplier.id}/assessments`, body)
    },
    onMutate: () => setError(null),
    onSuccess: () => { toast.success(assessment ? "Assessment saved" : "Assessment recorded"); setOpen(false); onSaved() },
    onError: (e: Error) => setError(e.message),
  })
  const upd = (i: number, patch: Partial<Finding>) => setFindings((p) => p.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) reset() }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{assessment ? "Edit assessment" : "Record assessment"}</DialogTitle>
          <DialogDescription>Questionnaire results can also be imported directly from the returned Excel workbook.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="as-date"><Input id="as-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Method"><OptionSelect value={method} onChange={setMethod} options={Object.entries(meta.methods).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Score (0–100)" htmlFor="as-score"><Input id="as-score" type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} aria-invalid={!scoreOk} /></Field>
          <Field label="Rating"><OptionSelect value={rating} onChange={setRating} allowNone noneLabel="Not rated" options={Object.entries(meta.ratings).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Next review due" htmlFor="as-next" className="col-span-2"
            hint={`Leave empty to follow the tier cycle (${supplier.review_months[supplier.tier]} months for the ${meta.tiers[supplier.tier].toLowerCase()} tier).`}>
            <Input id="as-next" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} className="w-48" />
          </Field>
          <Field label="Summary" htmlFor="as-sum" className="col-span-2"><Textarea id="as-sum" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-ink-2">Findings</span>
            <Button type="button" size="xs" variant="outline" onClick={() => setFindings((p) => [...p, { text: "", severity: "medium", action_item_id: null }])}><Plus /> Add finding</Button>
          </div>
          {findings.length === 0 && <p className="text-[12.5px] text-ink-3">No findings.</p>}
          {findings.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_auto] items-start gap-2">
              <Textarea aria-label="Finding" rows={1} value={f.text} onChange={(e) => upd(i, { text: e.target.value })} placeholder="What is missing or insufficient" />
              <OptionSelect value={f.severity} onChange={(v) => upd(i, { severity: (v ?? "medium") as Finding["severity"] })}
                options={[{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove finding" disabled={!!f.action_item_id}
                title={f.action_item_id ? "An action plan item exists for this finding" : undefined}
                onClick={() => setFindings((p) => p.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
        </div>
        {error && <ErrorState error={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!date || !method || !scoreOk || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : assessment ? "Save changes" : "Record assessment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FindingActionDialog({ supplier, assessment, index, finding, onSaved }: { supplier: SupplierDetail; assessment: Assessment; index: number; finding: Finding; onSaved: () => void }) {
  const { can } = useAuth()
  const allEntities = useEntities()
  const pool = supplier.entities.length ? supplier.entities : (allEntities.data ?? [])
  const entityChoices = pool.filter((e) => can("findings.manage", e.id))
  const [open, setOpen] = useState(false)
  const [entity, setEntity] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [priority, setPriority] = useState<string | null>("Medium")
  const [target, setTarget] = useState("")
  const [responsible, setResponsible] = useState<number | null>(null)
  const [req, setReq] = useState("5.1.6")
  const [error, setError] = useState<string | null>(null)
  const reset = () => {
    setEntity(entityChoices[0] ? String(entityChoices[0].id) : null)
    setTitle(`Supplier ${supplier.name}: ${finding.text}`.slice(0, 400))
    setPriority(finding.severity === "high" ? "High" : finding.severity === "low" ? "Low" : "Medium")
    setTarget(""); setResponsible(null); setReq("5.1.6"); setError(null)
  }
  const create = useMutation({
    mutationFn: () => api.post(`/suppliers/assessments/${assessment.id}/findings/${index}/action-item`, {
      entity_id: Number(entity), title: title.trim(), priority, target_date: target || null, responsible_id: responsible,
      requirement_number: req.trim() || "5.1.6",
    }),
    onMutate: () => setError(null),
    onSuccess: () => { toast.success("Action plan item created"); setOpen(false); onSaved() },
    onError: (e: Error) => setError(e.message),
  })
  if (entityChoices.length === 0) return null
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) reset() }}>
      <DialogTrigger asChild><Button size="xs" variant="outline">Create action item</Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create action plan item</DialogTitle>
          <DialogDescription>The item is added to the consolidated action plan of the chosen entity and linked to this finding.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entity">
            <OptionSelect value={entity} onChange={setEntity} placeholder="Choose entity…"
              options={entityChoices.map((e) => ({ value: String(e.id), label: <span><span className="font-mono text-[12px] text-ink-3">{e.code}</span> {e.name}</span> }))} />
          </Field>
          <Field label="Requirement" htmlFor="fa-req" hint="Catalogue number, e.g. 5.1.4 or 5.1.6"><Input id="fa-req" value={req} onChange={(e) => setReq(e.target.value)} className="font-mono" /></Field>
          <Field label="Title" htmlFor="fa-title" className="col-span-2"><Textarea id="fa-title" rows={2} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Priority"><OptionSelect value={priority} onChange={setPriority} options={PRIORITY_VALUES} /></Field>
          <Field label="Target date" htmlFor="fa-target"><Input id="fa-target" type="date" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
          <Field label="Responsible" className="col-span-2"><StakeholderSelect value={responsible} onChange={setResponsible} /></Field>
        </div>
        {error && <ErrorState error={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!entity || !title.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create action item"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
