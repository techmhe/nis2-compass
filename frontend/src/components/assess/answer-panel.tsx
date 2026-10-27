import { useState, type ReactNode } from "react"
import { Link, useNavigate } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle, Bot, Check, ChevronDown, ChevronRight, ChevronUp, Copy, ListPlus, Loader2, Lock, Plus, RotateCcw, Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Code, EntityTag, ErrorState, Loading, Pill, ScoreChip, StatusPill } from "@/components/common/basics"
import { CommentsPanel, Confirm, DocumentLinks, Markdown } from "@/components/common/collab"
import { Field, Segmented, StakeholderSelect, UserSelect, answerTone } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities, useStakeholders } from "@/hooks/useRefData"
import { ApiError, api } from "@/lib/api"
import { EFF_VALUES, EFFORT_VALUES, IMPL_VALUES, SCOPE_VALUES } from "@/lib/constants"
import { fmtDate, fmtDateTime, fromNow, isoDate } from "@/lib/format"
import type { ActionItem, AnswerDetail, AnswerRow, AssessmentDetail } from "@/lib/types"
import { cn } from "@/lib/utils"
import { EntityLegalBadge } from "@/components/governance/shared"
import { EvidenceCheckButton } from "@/components/ai/evidence-check"
import { EvidenceFreshness } from "./evidence-freshness"
import { ApprovalPanel } from "@/components/approvals/approval-panel"
import { CreateRiskFromAnswer } from "@/components/risks/create-risk-from-answer"
import { ProvisionList } from "./provisions"
import { CorePill, FIELD_LABEL, IdeTiles, ScopePill, readPref, writePref, type RequirementDetailResp } from "./shared"
import { answersKey, useTextDrafts, type AnswerChanges, type SaveState } from "./use-answers"

type Patch = (id: number, changes: AnswerChanges) => Promise<AnswerRow | null>

function scopeTone(v: string) {
  return v === "In Scope" ? "var(--petrol)" : v === "Central at HQ" ? "var(--brass)" : "var(--ink-3)"
}

export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "saving") return <span className="inline-flex items-center gap-1 text-[12px] text-ink-3" role="status"><Loader2 className="size-3.5 animate-spin" /> Saving…</span>
  if (state === "saved") return <span className="inline-flex items-center gap-1 text-[12px] text-sage" role="status"><Check className="size-3.5" /> Saved</span>
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-alarm" role="status">
        <AlertTriangle className="size-3.5" /> Not saved
        <button className="font-medium underline underline-offset-2" onClick={onRetry}>Retry</button>
      </span>
    )
  }
  return <span className="text-[12px] text-ink-3">Changes save automatically</span>
}

function FormRow({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 2xl:grid-cols-[104px_minmax(0,1fr)] 2xl:items-center 2xl:gap-3">
      <div className="flex items-baseline gap-2 text-[12.5px] font-medium text-ink-2 2xl:block">
        {label}{hint && <div className="text-[11px] font-normal text-ink-3">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** For requirements operated centrally, show the headquarters' answer that this entity relies on. */
function InheritedFromHq({ others, requirementId }: { others: AnswerDetail["other_entities"]; requirementId: number }) {
  const { data: entities = [] } = useEntities()
  const hq = entities.find((e) => e.is_headquarters)
  const a = hq ? others.find((o) => o.entity_code === hq.code) : undefined
  if (!hq) return null
  return (
    <div className="rounded-md border border-brass/40 bg-brass-50/60 px-3 py-2.5 text-[12.5px]">
      <div className="font-medium text-ink">Inherited from {hq.name}</div>
      {!a ? <p className="text-ink-3">The headquarters' answer is not visible to you.</p> : (
        <>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-2">
            <span>Implemented {a.implemented ?? "–"}</span><span>Documented {a.documented ?? "–"}</span>
            <span>Effectiveness {a.effectiveness ?? "–"}</span><span className="flex items-center gap-1">Score <ScoreChip value={a.score ?? null} /></span>
          </div>
          {a.evidence && <p className="mt-1 text-ink-3">Evidence: {a.evidence}</p>}
          {a.gap_description && <p className="mt-1 text-alarm">Open gap at HQ: {a.gap_description}</p>}
          <Link to={`/assessments/${a.assessment_id}?req=${requirementId}`} className="mt-1 inline-block text-petrol hover:underline">Open the headquarters' answer</Link>
        </>
      )}
    </div>
  )
}

function useSetRow(assessmentId: number) {
  const qc = useQueryClient()
  return (res: AnswerRow) => {
    qc.setQueryData<AnswerRow[]>(answersKey(assessmentId), (rows) =>
      rows?.map((r) => (r.id === res.id ? { ...res, doc_count: r.doc_count, comment_count: r.comment_count } : r)))
    qc.invalidateQueries({ queryKey: ["answer", res.id] })
    qc.invalidateQueries({ queryKey: ["action-items", "unplanned"] })
  }
}

export function AnswerPanel({ row, assessment, canEdit, patch, saveState, onRetry, plannedItem, canPlan, onMove, position, tab, onTabChange }: {
  row: AnswerRow
  assessment: AssessmentDetail
  canEdit: boolean
  patch: Patch
  saveState: SaveState
  onRetry: () => void
  plannedItem: ActionItem | undefined
  canPlan: boolean
  onMove: (delta: number) => void
  position: { index: number; total: number }
  tab: string
  onTabChange: (tab: string) => void
}) {
  const { can, canAny } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const entityId = assessment.entity.id
  const { drafts, setField, flush } = useTextDrafts(row, patch)
  const [cpOpen, setCpOpen] = useState(() => readPref("nis2-ws-checkpoints", true))
  const [legalOpen, setLegalOpen] = useState(() => readPref("nis2-ws-legal", false))
  const [suggestion, setSuggestion] = useState<Record<string, string | null> | null>(null)

  const detail = useQuery({ queryKey: ["answer", row.id], queryFn: () => api.get<AnswerDetail>(`/answers/${row.id}`) })
  const req = useQuery({
    queryKey: ["requirement", row.requirement_id],
    queryFn: () => api.get<RequirementDetailResp>(`/requirements/${row.requirement_id}`),
    enabled: canAny("catalog.read"),
    staleTime: 60_000,
  })
  const requirement = req.data?.requirement ?? detail.data?.requirement
  const sectionTitle = row.section.replace(/^[\d.]+\s*/, "")
  const set = (c: AnswerChanges) => { if (canEdit) patch(row.id, c) }

  const ai = useMutation({
    mutationFn: () => { flush(); return api.post<Record<string, string | null>>(`/ai/assist/answer/${row.id}`) },
    onSuccess: (s) => setSuggestion(s),
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 503) toast.error("The AI assistant is not configured yet. An administrator can connect a model under Administration, AI settings.")
      else toast.error(`No suggestion: ${e.message}`)
    },
  })
  const plan = useMutation({
    mutationFn: () => { flush(); return api.post<ActionItem[]>("/action-items/from-findings", { answer_ids: [row.id] }) },
    onSuccess: (items) => {
      qc.invalidateQueries({ queryKey: ["action-items"] })
      const it = items[0]
      if (it) toast.success(`Added to the action plan as ${it.code}`, { action: { label: "Open", onClick: () => navigate(`/action-plan?item=${it.id}`) } })
      else toast.info("This finding is already in the action plan")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const askAssistant = () => {
    const q = `Did we already answer requirement ${row.number} for other entities, and which documents cover it?`
    navigate(`/assistant?q=${encodeURIComponent(q)}`, { state: { context: { type: "requirement", id: row.requirement_id, label: `${row.number} ${sectionTitle}` } } })
  }

  const applySuggestion = () => {
    if (!suggestion) return
    if (suggestion.gap_description) setField("gap_description", suggestion.gap_description)
    if (suggestion.recommended_action) setField("recommended_action", suggestion.recommended_action)
    flush()
    const eff = suggestion.effort
    if (eff && (EFFORT_VALUES as readonly string[]).includes(eff) && !row.effort) set({ effort: eff })
    setSuggestion(null)
    toast.success("Suggestion applied. Review and adjust the text.")
  }

  const docs = detail.data?.documents ?? []
  const others = detail.data?.other_entities ?? []
  const tasks = detail.data?.tasks ?? []
  const outOfScope = row.scope !== "In Scope"

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* header */}
      <div className="border-b px-4 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <Code className="text-[13.5px] font-medium text-ink">{row.number}</Code>
          {row.is_core && <CorePill />}
          <ScopePill scope={row.scope} />
          <EntityLegalBadge entityId={entityId} requirementId={row.requirement_id} className="max-w-[260px]" />
          {row.finding_id && <Pill tone="alarm" title="Finding: a work package is required"><span className="font-mono">{row.finding_id}</span></Pill>}
          {row.review_status === "reviewed" && <Pill tone="sage">Reviewed</Pill>}
          <div className="ml-auto flex items-center gap-0.5">
            <span className="tabular mr-1 text-[11.5px] text-ink-3">{position.index >= 0 ? `${position.index + 1} of ${position.total}` : "Not in the filtered list"}</span>
            <Button size="icon-xs" variant="ghost" aria-label="Previous requirement (K)" onClick={() => onMove(-1)} disabled={!position.total || position.index === 0}><ChevronUp /></Button>
            <Button size="icon-xs" variant="ghost" aria-label="Next requirement (J)" onClick={() => onMove(1)} disabled={!position.total || position.index === position.total - 1}><ChevronDown /></Button>
          </div>
        </div>
        <h2 className="mt-1 text-[14px] leading-snug font-semibold text-ink">{sectionTitle}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {canAny("ai.use") && <Button size="xs" variant="outline" onClick={askAssistant}><Bot /> Ask assistant</Button>}
          {canAny("ai.use") && canEdit && (
            <Button size="xs" variant="outline" onClick={() => ai.mutate()} disabled={ai.isPending}>
              {ai.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} AI suggestion
            </Button>
          )}
          {plannedItem ? (
            <Link to={`/action-plan?item=${plannedItem.id}`} className="inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[12px] text-ink-2 hover:border-petrol hover:text-petrol">
              In action plan <Code className="text-[11.5px]">{plannedItem.code}</Code> <StatusPill value={plannedItem.status} />
            </Link>
          ) : row.wp_required && canPlan ? (
            <Button size="xs" variant="outline" onClick={() => plan.mutate()} disabled={plan.isPending}><ListPlus /> Add to action plan</Button>
          ) : null}
          <Link to={`/catalog/${row.requirement_id}`} className="ml-auto text-[12px] text-ink-3 hover:text-petrol">Requirement page</Link>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {/* requirement */}
        <div className="space-y-2.5 border-b px-4 py-3">
          <p className="text-[13.5px] leading-relaxed text-ink">{row.text}</p>
          {requirement?.check_points && (
            <Collapsed open={cpOpen} onToggle={() => { setCpOpen(!cpOpen); writePref("nis2-ws-checkpoints", !cpOpen) }} title="Check points">
              <div className="prose-law text-[12.5px] text-ink-2">{requirement.check_points}</div>
            </Collapsed>
          )}
          {requirement?.guidance && (
            <div className="rounded-md border border-brass/30 bg-brass-50 px-3 py-2">
              <div className="mb-0.5 text-[12px] font-medium text-brass">Guidance</div>
              <Markdown className="prose-md text-[12.5px]">{requirement.guidance}</Markdown>
            </div>
          )}
          <Collapsed open={legalOpen} onToggle={() => { setLegalOpen(!legalOpen); writePref("nis2-ws-legal", !legalOpen) }}
            title={<>Legal references{req.data ? <span className="font-normal text-ink-3"> ({req.data.provisions.length})</span> : null}</>}
            summary={
              <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-3">
                {requirement?.legal_reference && <Code className="text-[11.5px]">{requirement.legal_reference}</Code>}
                {requirement?.iso_reference && <span>ISO 27001 <Code className="text-[11.5px]">{requirement.iso_reference}</Code></span>}
              </span>
            }>
            {req.isLoading ? <Loading className="p-2" /> : req.error ? <ErrorState error={req.error} /> : (
              <div className="space-y-3">
                <ProvisionList provisions={req.data?.provisions ?? []} dense />
                {requirement?.iso_reference && (
                  <div className="text-[12.5px] text-ink-2">
                    <span className="text-ink-3">ISO/IEC 27001:2022 </span>
                    {requirement.iso_reference.split(/,\s*/).map((r) => <Code key={r} className="mr-1.5 inline-block rounded-[3px] border bg-surface px-1 text-[11.5px]">{r}</Code>)}
                  </div>
                )}
              </div>
            )}
          </Collapsed>
        </div>

        {!canEdit && (
          <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border bg-muted/60 px-3 py-2 text-[12.5px] text-ink-2">
            <Lock className="size-3.5 shrink-0" />
            {assessment.locked ? "This assessment is locked. Only assessment managers can change answers." : "You can view this answer but not change it."}
          </div>
        )}

        <Tabs value={tab} onValueChange={onTabChange} className="gap-0">
          <div className="sticky top-0 z-10 border-b bg-card px-2">
            <TabsList variant="line" className="h-9 w-full justify-start overflow-x-auto scroll-thin">
              <TabsTrigger value="answer" className="flex-none text-[12.5px]">Answer</TabsTrigger>
              <TabsTrigger value="evidence" className="flex-none text-[12.5px]">Evidence{row.doc_count ? <Count n={row.doc_count} /> : null}</TabsTrigger>
              <TabsTrigger value="others" className="flex-none text-[12.5px]">Other entities</TabsTrigger>
              <TabsTrigger value="history" className="flex-none text-[12.5px]">History</TabsTrigger>
              <TabsTrigger value="comments" className="flex-none text-[12.5px]">Comments{row.comment_count ? <Count n={row.comment_count} /> : null}</TabsTrigger>
              <TabsTrigger value="tasks" className="flex-none text-[12.5px]">Tasks{tasks.length ? <Count n={tasks.length} /> : null}</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="answer" className="space-y-4 px-4 py-4">
            <FormRow label="Scope">
              <Segmented size="sm" options={SCOPE_VALUES} value={row.scope} toneOf={scopeTone} disabled={!canEdit} onChange={(v) => v && set({ scope: v })} />
            </FormRow>
            <div className={cn("space-y-3", outOfScope && "opacity-60")}>
              <FormRow label="Implemented" hint="Keys 1 to 4">
                <Segmented size="sm" options={IMPL_VALUES} value={row.implemented} toneOf={answerTone} disabled={!canEdit} onChange={(v) => set({ implemented: v })} />
              </FormRow>
              <FormRow label="Documented">
                <Segmented size="sm" options={IMPL_VALUES} value={row.documented} toneOf={answerTone} disabled={!canEdit} onChange={(v) => set({ documented: v })} />
              </FormRow>
              <FormRow label="Effectiveness">
                <Segmented size="sm" options={EFF_VALUES} value={row.effectiveness} toneOf={answerTone} disabled={!canEdit} onChange={(v) => set({ effectiveness: v })} />
              </FormRow>
              {outOfScope && <p className="text-[12px] text-ink-3">Not scored: the requirement is {row.scope === "Central at HQ" ? "covered centrally at headquarters" : "not applicable"} for this entity.</p>}
            </div>
            {row.scope === "Central at HQ" && <InheritedFromHq others={others} requirementId={row.requirement_id} />}

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border bg-surface px-3 py-2 text-[12.5px]" aria-live="polite">
              <span className="flex items-center gap-1.5 text-ink-3">Score <ScoreChip value={row.score} /></span>
              <span className="text-ink-3">Work package required{" "}
                <span className={cn("font-medium", row.wp_required ? "text-alarm" : row.wp_required === false ? "text-sage" : "text-ink-3")}>
                  {row.wp_required == null ? "–" : row.wp_required ? "Yes" : "No"}
                </span>
              </span>
              <span className="text-ink-3">Finding {row.finding_id ? <Code className="text-alarm">{row.finding_id}</Code> : <span>–</span>}</span>
            </div>

            <Field label="Evidence and source" htmlFor="f-evidence">
              <Textarea id="f-evidence" value={drafts.evidence} disabled={!canEdit} rows={2} className="text-[13px]"
                placeholder="What was shown or referenced, e.g. policy v2.1 section 4, interview with IT lead"
                onChange={(e) => setField("evidence", e.target.value)} onBlur={flush} />
            </Field>
            <Field label="Gap description" htmlFor="f-gap">
              <Textarea id="f-gap" value={drafts.gap_description} disabled={!canEdit} rows={2} className="text-[13px]"
                placeholder={row.wp_required ? "Describe what is missing" : "Only needed when a gap was found"}
                onChange={(e) => setField("gap_description", e.target.value)} onBlur={flush} />
            </Field>
            <Field label="Recommended action" htmlFor="f-action">
              <Textarea id="f-action" value={drafts.recommended_action} disabled={!canEdit} rows={2} className="text-[13px]"
                placeholder="Smallest practical action that closes the gap"
                onChange={(e) => setField("recommended_action", e.target.value)} onBlur={flush} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Responsible" className="col-span-2">
                <StakeholderSelect value={row.responsible?.id ?? null} disabled={!canEdit} onChange={(v) => set({ responsible_id: v })} />
              </Field>
              <Field label="Target date" htmlFor="f-target">
                <Input id="f-target" type="date" value={row.target_date ?? ""} disabled={!canEdit} onChange={(e) => set({ target_date: e.target.value || null })} />
              </Field>
              <Field label="Effort">
                <Segmented size="sm" options={EFFORT_VALUES} value={row.effort} disabled={!canEdit} onChange={(v) => set({ effort: v })} />
              </Field>
            </div>
            <Field label="Internal notes" hint="Interview notes; not exported to the action plan" htmlFor="f-notes">
              <Textarea id="f-notes" value={drafts.notes} disabled={!canEdit} rows={2} className="text-[13px]"
                onChange={(e) => setField("notes", e.target.value)} onBlur={flush} />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-md border bg-surface px-3 py-2">
              <span>
                <span className="block text-[13px] font-medium text-ink">Reviewed</span>
                <span className="block text-[12px] text-ink-3">Mark once a second person has checked this answer.</span>
              </span>
              <Switch checked={row.review_status === "reviewed"} disabled={!canEdit} aria-label="Reviewed"
                onCheckedChange={(v) => set({ review_status: v ? "reviewed" : "draft" })} />
            </label>
            {!outOfScope && (
              <ApprovalPanel targetType="answer" targetId={row.id} entityId={entityId} title="Four-eyes review"
                requestLabel="Request review" onChanged={() => qc.invalidateQueries({ queryKey: answersKey(assessment.id) })} />
            )}
            {canAny("risks.read") && !outOfScope && (row.wp_required || row.implemented === "No") && (
              <CreateRiskFromAnswer answerId={row.id} requirementNumber={row.number} section={sectionTitle} entityId={entityId} />
            )}
            <div className="flex items-center justify-between text-[12px] text-ink-3">
              <SaveIndicator state={saveState} onRetry={onRetry} />
              <span>Last change {fromNow(row.updated_at)}</span>
            </div>
          </TabsContent>

          <TabsContent value="evidence" className="px-4 py-4">
            {detail.isLoading ? <Loading /> : detail.error ? <ErrorState error={detail.error} /> : (
              <>
                {canAny("controls.read") && <EvidenceFreshness assessmentId={assessment.id} answerId={row.id} />}
                <p className="mb-3 text-[12.5px] text-ink-3">Documents that prove this answer for {assessment.entity.name}. Upload new evidence or link a document that already exists.</p>
                <DocumentLinks targetType="answer" targetId={row.id} documents={docs} entityId={entityId}
                  canEdit={canEdit && canAny("documents.read")}
                  onChange={() => { qc.invalidateQueries({ queryKey: ["answer", row.id] }); qc.invalidateQueries({ queryKey: answersKey(assessment.id) }) }} />
                {canAny("ai.use") && docs.length > 0 && (
                  <div className="mt-4 flex items-center gap-3 border-t pt-3">
                    <EvidenceCheckButton answerId={row.id} canEdit={canEdit}
                      onUseAsNote={(text) => { setField("notes", drafts.notes ? `${drafts.notes}\n\n${text}` : text); flush() }} />
                    <span className="text-[12px] text-ink-3">Let the assistant compare the linked documents with the check points.</span>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="others" className="px-4 py-4">
            {detail.isLoading ? <Loading /> : detail.error ? <ErrorState error={detail.error} /> : (
              <OtherEntities row={row} others={others} canEdit={canEdit} assessmentId={assessment.id} flush={flush} entityName={assessment.entity.name} />
            )}
          </TabsContent>

          <TabsContent value="history" className="px-4 py-4">
            {detail.isLoading ? <Loading /> : detail.error ? <ErrorState error={detail.error} /> : detail.data && (
              <HistoryTab detail={detail.data} row={row} canEdit={canEdit} assessmentId={assessment.id} flush={flush} />
            )}
          </TabsContent>

          <TabsContent value="comments" className="px-4 py-4">
            <CommentsPanel targetType="answer" targetId={row.id} canComment={can("assessments.edit", entityId)} />
          </TabsContent>

          <TabsContent value="tasks" className="px-4 py-4">
            {detail.isLoading ? <Loading /> : detail.error ? <ErrorState error={detail.error} /> : (
              <TasksTab row={row} tasks={tasks} canCreate={can("assessments.edit", entityId)} entityName={assessment.entity.name} />
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!suggestion} onOpenChange={(o) => !o && setSuggestion(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>AI suggestion for {row.number}</DialogTitle>
            <DialogDescription>Drafted from the requirement, your current answer and related documents. Check it before applying.</DialogDescription>
          </DialogHeader>
          {suggestion && (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto scroll-thin text-[13px]">
              {([["gap_description", "Gap description"], ["recommended_action", "Recommended action"], ["acceptance_criterion", "Acceptance criterion"],
                ["expected_evidence", "Expected evidence"], ["effort", "Effort"]] as const).map(([k, label]) => suggestion[k] ? (
                <div key={k}>
                  <div className="mb-0.5 text-[12px] font-medium text-ink-3">{label}</div>
                  <div className="rounded-md border bg-surface px-3 py-2 whitespace-pre-wrap text-ink">{suggestion[k]}</div>
                </div>
              ) : null)}
              <p className="text-[12px] text-ink-3">Applying fills gap description and recommended action{row.effort ? "" : " and effort"}. Acceptance criterion and expected evidence are set in the action plan.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuggestion(null)}>Discard</Button>
            <Button onClick={applySuggestion}>Apply to answer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Count({ n }: { n: number }) {
  return <span className="tabular ml-1 rounded-full bg-muted px-1.5 text-[11px] text-ink-2">{n}</span>
}

function Collapsed({ open, onToggle, title, summary, children }: { open: boolean; onToggle: () => void; title: ReactNode; summary?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-1.5 text-left">
        <ChevronRight className={cn("mt-0.5 size-3.5 shrink-0 text-ink-3 transition-transform", open && "rotate-90")} />
        <span className="shrink-0 text-[12.5px] font-medium text-ink-2">{title}</span>
        {!open && summary && <span className="ml-2 min-w-0 flex-1">{summary}</span>}
      </button>
      {open && <div className="mt-1.5 pl-5">{children}</div>}
    </div>
  )
}

function OtherEntities({ row, others, canEdit, assessmentId, flush, entityName }: {
  row: AnswerRow
  others: AnswerDetail["other_entities"]
  canEdit: boolean
  assessmentId: number
  flush: () => void
  entityName: string
}) {
  const setRow = useSetRow(assessmentId)
  const copy = useMutation({
    mutationFn: (sourceId: number) => { flush(); return api.post<AnswerRow>(`/answers/${row.id}/copy`, { source_answer_id: sourceId }) },
    onSuccess: (res) => { setRow(res); toast.success("Answer copied. You can undo it in History.") },
    onError: (e: Error) => toast.error(e.message),
  })
  if (!others.length) return <p className="text-[13px] text-ink-3">No other entity assessment of this requirement is visible to you in this round.</p>
  return (
    <ul className="space-y-2.5">
      {others.map((o) => {
        const answered = !!(o.implemented || o.documented || o.effectiveness || o.evidence)
        return (
          <li key={o.answer_id} className="rounded-md border bg-surface p-3">
            <div className="flex items-center gap-2">
              <EntityTag code={o.entity_code} name={o.entity_name} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{o.entity_name}</span>
              <ScopePill scope={o.scope} />
              <IdeTiles row={o} />
              <ScoreChip value={o.score} />
            </div>
            {answered ? (
              <dl className="mt-2 space-y-1 text-[12.5px]">
                {o.evidence && <div><dt className="inline text-ink-3">Evidence </dt><dd className="inline text-ink-2">{o.evidence}</dd></div>}
                {o.gap_description && <div><dt className="inline text-ink-3">Gap </dt><dd className="inline text-ink-2">{o.gap_description}</dd></div>}
                {o.recommended_action && <div><dt className="inline text-ink-3">Action </dt><dd className="inline text-ink-2">{o.recommended_action}</dd></div>}
              </dl>
            ) : <p className="mt-1.5 text-[12.5px] text-ink-3">Not answered yet.</p>}
            <div className="mt-2 flex items-center gap-2">
              {o.finding_id && <Code className="text-[11.5px] text-alarm">{o.finding_id}</Code>}
              <Link to={`/assessments/${o.assessment_id}?req=${row.requirement_id}`} className="ml-auto text-[12px] text-petrol hover:underline">Open in {o.entity_code}</Link>
              {canEdit && answered && (
                <Confirm destructive={false} confirmLabel="Copy answer" title={`Copy the ${o.entity_code} answer to ${entityName}?`}
                  description="Scope, the three answers, evidence, gap description and recommended action are overwritten. You can revert the change in History."
                  onConfirm={() => copy.mutate(o.answer_id)}
                  trigger={<Button size="xs" variant="outline" disabled={copy.isPending}><Copy /> Copy to this entity</Button>} />
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function fmtValue(field: string, v: unknown, stakeholderName: (id: number) => string | undefined): string {
  if (v === null || v === undefined || v === "") return "empty"
  if (field === "responsible_id") return stakeholderName(Number(v)) ?? `#${v}`
  if (field === "target_date") return fmtDate(String(v))
  if (field === "review_status") return v === "reviewed" ? "Reviewed" : "Draft"
  return String(v)
}

function HistoryTab({ detail, row, canEdit, assessmentId, flush }: { detail: AnswerDetail; row: AnswerRow; canEdit: boolean; assessmentId: number; flush: () => void }) {
  const { data: stakeholders = [] } = useStakeholders()
  const name = (id: number) => stakeholders.find((s) => s.id === id)?.name
  const setRow = useSetRow(assessmentId)
  const restore = useMutation({
    mutationFn: (revId: number) => { flush(); return api.post<AnswerRow>(`/answers/${row.id}/restore/${revId}`) },
    onSuccess: (res) => { setRow(res); toast.success("Change reverted") },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-[12.5px] font-semibold text-ink">Previous rounds</h3>
        {detail.history.length === 0 ? <p className="text-[12.5px] text-ink-3">This is the first round in which this requirement was assessed for the entity.</p> : (
          <ul className="space-y-1">
            {detail.history.map((h) => (
              <li key={h.answer_id} className="flex items-center gap-3 rounded-md border bg-surface px-2.5 py-1.5 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate text-ink-2">{h.round}</span>
                <IdeTiles row={h} />
                <ScoreChip value={h.score} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-[12.5px] font-semibold text-ink">Changes in this round</h3>
        {detail.revisions.length === 0 ? <p className="text-[12.5px] text-ink-3">No changes recorded yet.</p> : (
          <ol className="space-y-2">
            {detail.revisions.map((r) => (
              <li key={r.id} className="rounded-md border bg-surface px-3 py-2">
                <div className="flex items-center gap-2 text-[12px] text-ink-3">
                  <span className="font-medium text-ink-2">{r.by ?? "System"}</span>
                  <Tooltip>
                    <TooltipTrigger asChild><span>{fromNow(r.changed_at)}</span></TooltipTrigger>
                    <TooltipContent>{fmtDateTime(r.changed_at)}</TooltipContent>
                  </Tooltip>
                  {canEdit && (
                    <Confirm destructive={false} confirmLabel="Revert change" title="Revert this change?"
                      description="The fields of this change are set back to their previous values. The revert itself is recorded as a new change."
                      onConfirm={() => restore.mutate(r.id)}
                      trigger={<Button size="xs" variant="ghost" className="ml-auto h-5" disabled={restore.isPending}><RotateCcw /> Revert</Button>} />
                  )}
                </div>
                <dl className="mt-1 space-y-0.5 text-[12.5px]">
                  {Object.entries(r.changes).map(([field, [oldV, newV]]) => (
                    <div key={field} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
                      <dt className="text-ink-3">{FIELD_LABEL[field] ?? field}</dt>
                      <dd className="min-w-0">
                        <span className="line-clamp-2 text-ink-3 line-through decoration-ink-3/50">{fmtValue(field, oldV, name)}</span>
                        <span className="line-clamp-3 text-ink">{fmtValue(field, newV, name)}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function TasksTab({ row, tasks, canCreate, entityName }: { row: AnswerRow; tasks: AnswerDetail["tasks"]; canCreate: boolean; entityName: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const defaults = () => ({
    title: `Provide evidence for ${row.number}`,
    description: `Please provide evidence for requirement ${row.number} (${row.section.replace(/^[\d.]+\s*/, "")}) for ${entityName}.${row.gap_description ? `\n\nCurrent gap: ${row.gap_description}` : ""}`,
    assignee: null as number | null,
    due: isoDate(new Date(Date.now() + 14 * 86_400_000)),
  })
  const [form, setForm] = useState(defaults)
  const create = useMutation({
    mutationFn: () => api.post<{ id: number; key: string }>("/tasks", {
      title: form.title.trim(), description: form.description.trim() || null, assignee_id: form.assignee, due_date: form.due || null, answer_id: row.id,
    }),
    onSuccess: (t) => {
      toast.success(`Task ${t.key} created`)
      qc.invalidateQueries({ queryKey: ["answer", row.id] })
      qc.invalidateQueries({ queryKey: ["tasks"] })
      setOpen(false); setForm(defaults())
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="space-y-3">
      {tasks.length === 0 && !open && <p className="text-[13px] text-ink-3">No tasks linked. Request evidence from a colleague to track it here.</p>}
      {tasks.length > 0 && (
        <ul className="space-y-1">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-[13px]">
              <Code className="text-[11.5px]">{t.key}</Code>
              <Link to={`/tasks?task=${t.id}`} className="min-w-0 flex-1 truncate hover:text-petrol">{t.title}</Link>
              <span className="truncate text-[12px] text-ink-3">{t.assignee ?? "Unassigned"}</span>
              <span className="tabular text-[12px] text-ink-3">{fmtDate(t.due_date, "")}</span>
              <StatusPill value={t.status} />
            </li>
          ))}
        </ul>
      )}
      {canCreate && !open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus /> Request evidence</Button>}
      {open && (
        <div className="space-y-3 rounded-md border bg-surface p-3">
          <Field label="Title" htmlFor="t-title"><Input id="t-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Description" htmlFor="t-desc"><Textarea id="t-desc" rows={3} className="text-[13px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Assignee"><UserSelect value={form.assignee} onChange={(v) => setForm({ ...form, assignee: v })} /></Field>
            <Field label="Due date" htmlFor="t-due"><Input id="t-due" type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => { setOpen(false); setForm(defaults()) }}>Cancel</Button>
            <Button size="sm" disabled={!form.title.trim() || create.isPending} onClick={() => create.mutate()}>Create task</Button>
          </div>
        </div>
      )}
    </div>
  )
}
