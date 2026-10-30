import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardCheck, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ApprovalPanel } from "@/components/approvals/approval-panel"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { WritingHelp } from "@/components/ai/writing-help"
import { Empty, EntityTag, ErrorState, Loading, Section, Stat } from "@/components/common/basics"
import { Confirm, DocumentLinks } from "@/components/common/collab"
import { EntitySelect, Field, OptionSelect } from "@/components/common/fields"
import { useChapters } from "@/components/assess/shared"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { EntityFilter, GroupPill, RatingPill, ReviewStatusPill, auditKeys, invalidateAudits } from "./shared"
import { EFFECTIVENESS_RATINGS, type CollectedInputs, type EffectivenessReview, type EffectivenessRow } from "./types"

const CHAPTERS = Array.from({ length: 21 }, (_, i) => i + 1)

function useReviews(entity: number | null) {
  return useQuery({ queryKey: auditKeys.reviews, queryFn: () => api.get<EffectivenessReview[]>("/audits/effectiveness-reviews", entity != null ? { entity_id: entity } : undefined) })
}

/* ---------- create ---------- */

function CreateDialog({ open, onOpenChange, defaultEntity }: { open: boolean; onOpenChange: (o: boolean) => void; defaultEntity: number | null }) {
  const qc = useQueryClient()
  const [entityId, setEntityId] = useState<number | null>(defaultEntity)
  const [period, setPeriod] = useState(String(new Date().getFullYear()))
  useEffect(() => { if (open) { setEntityId(defaultEntity); setPeriod(String(new Date().getFullYear())) } }, [open, defaultEntity])
  const save = useMutation({
    mutationFn: () => api.post<EffectivenessReview>("/audits/effectiveness-reviews", { entity_id: entityId, period: period.trim() }),
    onSuccess: () => { toast.success("Effectiveness review created"); invalidateAudits(qc); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New effectiveness review</DialogTitle>
          <DialogDescription>Written evaluation of the effectiveness of the risk-management measures (Cbb Art. 18).</DialogDescription>
        </DialogHeader>
        <Field label="Entity"><EntitySelect value={entityId} onChange={setEntityId} groupLabel="Group-wide" /></Field>
        <Field label="Period" hint="e.g. the year" htmlFor="er-period"><Input id="er-period" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!period.trim() || save.isPending} onClick={() => save.mutate()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- collected inputs ---------- */

function CollectedInputsCard({ reviewId }: { reviewId: number }) {
  const q = useQuery({ queryKey: auditKeys.reviewInputs(reviewId), queryFn: () => api.get<CollectedInputs>(`/audits/effectiveness-reviews/${reviewId}/collect-inputs`) })
  if (q.isLoading) return <Loading className="p-0" />
  const d = q.data
  if (!d) return null
  return (
    <Section title="Collected inputs" actions={<Button size="icon-xs" variant="ghost" aria-label="Refresh" onClick={() => q.refetch()}><RefreshCw /></Button>}>
      <p className="mb-3 text-[12px] text-ink-3">Read-only aggregate generated {fmtDate(d.generated_at)}, for reference while writing the evaluation.</p>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="GAP coverage" value={d.gap?.coverage != null ? `${Math.round(d.gap.coverage * 100)}%` : "–"} hint={d.gap?.average_score != null ? `avg. score ${Math.round(d.gap.average_score * 100)}%` : undefined} />
        <Stat label="Open actions" value={d.action_plan.open} hint={`${d.action_plan.overdue} overdue`} tone={d.action_plan.overdue ? "alarm" : undefined} />
        <Stat label="KPIs off target" value={d.kpis_off_target} tone={d.kpis_off_target ? "amber" : undefined} />
        <Stat label="Incidents (12 mo.)" value={d.incidents_last_12_months} />
      </div>
      <p className="mt-3 text-[12.5px] text-ink-2">{d.audit_findings_open} open audit finding{d.audit_findings_open === 1 ? "" : "s"}.</p>
    </Section>
  )
}

/* ---------- detail sheet ---------- */

function ReviewSheet({ reviewId, onClose }: { reviewId: number | null; onClose: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: auditKeys.review(reviewId ?? 0), queryFn: () => api.get<EffectivenessReview>(`/audits/effectiveness-reviews/${reviewId}`), enabled: reviewId != null })
  const [rows, setRows] = useState<EffectivenessRow[]>([])
  const [conclusion, setConclusion] = useState("")
  useEffect(() => { if (q.data) { setRows(q.data.rows); setConclusion(q.data.conclusion ?? "") } }, [q.data])
  const del = useMutation({
    mutationFn: () => api.del(`/audits/effectiveness-reviews/${reviewId}`),
    onSuccess: () => { toast.success("Review deleted"); invalidateAudits(qc); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  const save = useMutation({
    mutationFn: () => api.put<EffectivenessReview>(`/audits/effectiveness-reviews/${reviewId}`, { rows, conclusion: conclusion.trim() || null }),
    onSuccess: () => { toast.success("Saved"); invalidateAudits(qc); qc.invalidateQueries({ queryKey: auditKeys.review(reviewId ?? 0) }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const r = q.data
  const setRow = (chapter: number, patch: Partial<EffectivenessRow>) => {
    setRows((xs) => {
      const exists = xs.some((x) => x.chapter === chapter)
      if (!exists) return [...xs, { chapter, rating: "not_assessed", rationale: "", ...patch }]
      return xs.map((x) => (x.chapter === chapter ? { ...x, ...patch } : x))
    })
  }
  const chapters = useChapters()
  const rowFor = (chapter: number): EffectivenessRow => rows.find((x) => x.chapter === chapter) ?? { chapter, rating: "not_assessed", rationale: "" }
  const editable = r?.can_edit ?? false
  return (
    <Sheet open={reviewId != null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[720px]">
        {r && (
          <>
            <SheetHeader className="border-b px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                {r.entity ? <EntityTag code={r.entity.code} name={r.entity.name} /> : <GroupPill />}
                <ReviewStatusPill status={r.status} />
              </div>
              <SheetTitle className="text-[16px]">Effectiveness evaluation {r.period}</SheetTitle>
              <SheetDescription>Cbb Art. 18: periodic written evaluation of the effectiveness of the risk-management measures.</SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-5 py-4">
              {r.status === "approved" && r.approved_at && (
                <p className="rounded-md bg-sage-50 px-3 py-2 text-[12.5px] text-sage">Approved by {r.approved_by} on {fmtDate(r.approved_at)}.</p>
              )}
              {editable && <CollectedInputsCard reviewId={r.id} />}
              <Section title="Per-chapter evaluation">
                <ul className="divide-y">
                  {CHAPTERS.map((ch) => {
                    const row = rowFor(ch)
                    const title = chapters.data?.find((c) => c.number === ch)?.title
                    return (
                      <li key={ch} className="grid grid-cols-[minmax(0,220px)_180px_minmax(0,1fr)] items-start gap-3 py-2">
                        <span className="pt-1.5 text-[12.5px] text-ink-2"><span className="font-mono text-ink-3">{ch}</span>{title ? ` ${title}` : ""}</span>
                        {editable ? (
                          <OptionSelect value={row.rating} onChange={(v) => setRow(ch, { rating: (v ?? "not_assessed") as EffectivenessRow["rating"] })} options={EFFECTIVENESS_RATINGS} />
                        ) : <div className="pt-1"><RatingPill rating={row.rating} /></div>}
                        {editable ? (
                          <Textarea rows={1} value={row.rationale ?? ""} placeholder="Rationale" onChange={(e) => setRow(ch, { rationale: e.target.value })} />
                        ) : <p className="pt-1.5 text-[12.5px] text-ink-2">{row.rationale}</p>}
                      </li>
                    )
                  })}
                </ul>
              </Section>
              <Section title="Overall conclusion">
                {editable ? (
                  <Field label="Conclusion" htmlFor="eff-conclusion"
                    action={<WritingHelp target={{ type: "effectiveness_review", id: r.id }} field="conclusion" value={conclusion} onApply={setConclusion} autosave={false} />}>
                    <Textarea id="eff-conclusion" rows={4} value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
                  </Field>
                ) : <p className="text-[13px] whitespace-pre-wrap text-ink-2">{r.conclusion}</p>}
              </Section>
              {editable && (
                <div className="flex gap-2">
                  <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
                  <Confirm title="Delete this review?" description="This cannot be undone." onConfirm={() => del.mutateAsync()}
                    trigger={<Button size="sm" variant="ghost" className="text-alarm hover:text-alarm"><Trash2 /> Delete</Button>} />
                </div>
              )}
              <ApprovalPanel targetType="effectiveness_review" targetId={r.id} entityId={r.entity_id}
                requestDisabledReason={!rows.length ? "Rate at least one chapter first" : !conclusion.trim() ? "Write the overall conclusion first" : null}
                onChanged={() => qc.invalidateQueries({ queryKey: auditKeys.review(r.id) })} />
              <div>
                <h3 className="mb-2 text-[13px] font-semibold">Evidence</h3>
                <DocumentLinks targetType="effectiveness_review" targetId={r.id} documents={r.documents ?? []} entityId={r.entity_id} canEdit={editable}
                  onChange={() => qc.invalidateQueries({ queryKey: auditKeys.review(r.id) })} />
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ---------- main view ---------- */

export function EffectivenessReviewsView() {
  const { canAny } = useAuth()
  const [params, setParams] = useSearchParams()
  const [entity, setEntity] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const q = useReviews(entity)
  const canManage = canAny("audits.manage")

  const selectedId = Number(params.get("review")) || null
  const setSelected = (id: number | null) => setParams((p) => { if (id) p.set("review", String(id)); else p.delete("review"); return p }, { replace: true })

  const sorted = useMemo(() => [...(q.data ?? [])].sort((a, b) => b.period.localeCompare(a.period)), [q.data])

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState error={q.error} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <EntityFilter value={entity} onChange={setEntity} className="w-60" />
        {canManage && <Button className="ml-auto" onClick={() => setCreating(true)}><Plus /> New review</Button>}
      </div>
      {!sorted.length ? (
        <Section><Empty icon={<ClipboardCheck className="size-6" />} title="No effectiveness review yet">
          Cbb Art. 18 requires a periodic written evaluation of the effectiveness of the risk-management measures.
        </Empty></Section>
      ) : (
        <Section bodyClassName="p-0">
          <ul className="divide-y">
            {sorted.map((r) => (
              <li key={r.id}>
                <button className="grid w-full grid-cols-[100px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-muted" onClick={() => setSelected(r.id)}>
                  <span className="font-mono text-[12.5px] text-ink-3">{r.period}</span>
                  <span className="flex items-center gap-2">
                    {r.entity ? <EntityTag code={r.entity.code} name={r.entity.name} /> : <GroupPill />}
                    <span className="text-[13px] text-ink">{r.rows.length} chapter{r.rows.length === 1 ? "" : "s"} rated</span>
                  </span>
                  <ReviewStatusPill status={r.status} />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <CreateDialog open={creating} onOpenChange={setCreating} defaultEntity={entity} />
      <ReviewSheet reviewId={selectedId} onClose={() => setSelected(null)} />
    </div>
  )
}
