import { useState } from "react"
import { Link } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Code, EntityTag, ErrorState, KV, Loading, Section, StatusPill } from "@/components/common/basics"
import { CommentsPanel, DocumentLinks } from "@/components/common/collab"
import { Field, Segmented } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate, isoDate } from "@/lib/format"
import { OwnerEvidence } from "./owner-evidence"
import { daysFromToday, daysLabel, OccurrencePill, RESULT_LABEL, scheduleText } from "./shared"
import type { OccResult, OccurrenceDetail } from "./types"

const STATUS_OPTIONS = ["Done", "Skipped", "Not yet performed"] as const
const RESULT_OPTIONS = ["Effective", "Partially effective", "Not effective"] as const
const toResult: Record<string, OccResult> = { Effective: "effective", "Partially effective": "partially_effective", "Not effective": "not_effective" }

/** Side sheet with one control occurrence: record the result, evidence, finding and comments. */
export function OccurrenceSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  return (
    <Sheet open={id != null} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[640px]">
        {id != null && <OccurrenceBody id={id} />}
      </SheetContent>
    </Sheet>
  )
}

function OccurrenceBody({ id }: { id: number }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const key = ["controls", "occurrence", id]
  const q = useQuery({ queryKey: key, queryFn: () => api.get<OccurrenceDetail>(`/controls/occurrences/${id}`) })
  if (q.isLoading) return <><SheetHeader><SheetTitle>Control occurrence</SheetTitle><SheetDescription className="sr-only">Loading</SheetDescription></SheetHeader><Loading /></>
  if (q.error || !q.data) {
    return (
      <>
        <SheetHeader><SheetTitle>Control occurrence</SheetTitle><SheetDescription className="sr-only">Error</SheetDescription></SheetHeader>
        <ErrorState className="m-4" error={q.error ?? "Not found"} />
      </>
    )
  }
  const { occurrence: o, activity: a, documents, action_item } = q.data
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: ["controls"] })
  }
  const due = daysFromToday(o.due_date)
  const canManage = can("controls.manage", o.entity.id)
  return (
    <>
      <SheetHeader className="border-b px-5 py-4">
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <Code>{a.code}</Code>
          <EntityTag code={o.entity.code} name={o.entity.name} />
          <span>{o.period_label}</span>
        </div>
        <SheetTitle className="text-[17px] leading-snug">{a.title}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <OccurrencePill status={o.status} result={o.result} />
          <span>Due {fmtDate(o.due_date)}{o.status === "planned" || o.status === "overdue" ? ` (${daysLabel(due)})` : ""}</span>
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-5 py-4">
        <div className="rounded-md border bg-surface px-3 py-2">
          {a.description && <p className="mb-2 text-[13px] text-ink-2">{a.description}</p>}
          <KV label="Required evidence">{a.required_evidence}</KV>
          <KV label="Schedule">{scheduleText(a.recurrence, a.anchor_month, a.rrule)}</KV>
          <KV label="Owner">{[a.owner_user_name, a.owner_stakeholder_name].filter(Boolean).join(", ") || null}</KV>
          <KV label="Requirements">
            {a.requirements.length ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {a.requirements.map((r) => (
                  <Link key={r.id} to={`/catalog/${r.id}`} className="hover:text-petrol" title={r.section}><Code>{r.number}</Code></Link>
                ))}
              </span>
            ) : null}
          </KV>
          {a.legal_refs && <KV label="Legal basis"><Code>{a.legal_refs}</Code></KV>}
        </div>

        {q.data.can_record ? (
          <RecordForm key={o.updated_at} detail={q.data} onSaved={refresh} />
        ) : (
          <Section title="Result">
            {o.status === "done" ? (
              <div className="text-[13px]">
                <KV label="Result">{o.result ? RESULT_LABEL[o.result] : null}</KV>
                <KV label="Performed">{fmtDate(o.performed_at)}{o.performed_by_name ? ` by ${o.performed_by_name}` : ""}</KV>
                <KV label="Notes">{o.notes}</KV>
              </div>
            ) : (
              <p className="text-[13px] text-ink-3">
                {o.status === "skipped" ? `Skipped: ${o.notes ?? "no reason given"}` : "Not performed yet. The control owner or a control manager for this entity records the result."}
              </p>
            )}
          </Section>
        )}

        {action_item && (
          <div className="flex items-center gap-2 rounded-md border border-alarm/30 bg-alarm-50/50 px-3 py-2 text-[13px]">
            <span className="text-ink-2">Finding:</span>
            <Link to={`/action-plan?item=${action_item.id}`} className="flex min-w-0 flex-1 items-center gap-2 hover:text-petrol">
              <Code>{action_item.code}</Code><span className="truncate">{action_item.title}</span>
            </Link>
            <StatusPill value={action_item.status} />
          </div>
        )}

        <Section title="Evidence">
          {!canManage && q.data.can_record ? (
            <OwnerEvidence occurrenceId={o.id} entityId={o.entity.id} documents={documents} onChange={refresh} />
          ) : (
            <DocumentLinks targetType="control_occurrence" targetId={o.id} documents={documents} entityId={o.entity.id}
              canEdit={canManage} onChange={refresh} />
          )}
        </Section>
        <Section title="Comments">
          <CommentsPanel targetType="control_occurrence" targetId={o.id} canComment={canManage} />
        </Section>
      </div>
    </>
  )
}

function RecordForm({ detail, onSaved }: { detail: OccurrenceDetail; onSaved: () => void }) {
  const o = detail.occurrence
  const [status, setStatus] = useState<string>(o.stored_status === "done" ? "Done" : o.stored_status === "skipped" ? "Skipped" : "Done")
  const [result, setResult] = useState<string | null>(o.result ? Object.keys(toResult).find((k) => toResult[k] === o.result)! : null)
  const [performed, setPerformed] = useState(o.performed_at ?? isoDate(new Date()))
  const [notes, setNotes] = useState(o.notes ?? "")
  const [finding, setFinding] = useState(true)
  const [findingTitle, setFindingTitle] = useState("")
  const [error, setError] = useState<string | null>(null)

  const needsFinding = status === "Done" && result === "Not effective" && !o.action_item_id
  const save = useMutation({
    mutationFn: () => api.put(`/controls/occurrences/${o.id}`, {
      status: status === "Done" ? "done" : status === "Skipped" ? "skipped" : "planned",
      result: status === "Done" && result ? toResult[result] : null,
      performed_at: status === "Done" ? performed || null : null,
      notes: notes.trim() || null,
      create_finding: needsFinding && finding,
      finding_title: findingTitle.trim() || null,
    }),
    onMutate: () => setError(null),
    onSuccess: () => { toast.success(status === "Done" ? "Result recorded" : status === "Skipped" ? "Occurrence skipped" : "Occurrence reset to planned"); onSaved() },
    onError: (e: Error) => setError(e.message),
  })
  const invalid = (status === "Done" && !result) || (status === "Skipped" && !notes.trim()) || (needsFinding && !finding)

  return (
    <Section title="Record result">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate() }}>
        <Field label="Status">
          <div><Segmented value={status} onChange={(v) => setStatus(v ?? status)} options={STATUS_OPTIONS} /></div>
        </Field>
        {status === "Done" && (
          <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
            <Field label="Result">
              <div>
                <Segmented value={result} onChange={setResult} options={RESULT_OPTIONS}
                  toneOf={(v) => (v === "Effective" ? "var(--petrol)" : v === "Partially effective" ? "var(--amber)" : "var(--alarm)")} />
              </div>
            </Field>
            <Field label="Performed on" htmlFor="occ-performed">
              <Input id="occ-performed" type="date" value={performed} max={isoDate(new Date())} onChange={(e) => setPerformed(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label={status === "Skipped" ? "Reason for skipping" : "Notes"} htmlFor="occ-notes">
          <Textarea id="occ-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={status === "Skipped" ? "Why is this occurrence not performed?" : "Scope, observations, deviations"} />
        </Field>
        {needsFinding && (
          <div className="space-y-2 rounded-md border border-alarm/30 bg-alarm-50/40 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <Checkbox id="occ-finding" checked={finding} onCheckedChange={(v) => setFinding(v === true)} className="mt-0.5" />
              <Label htmlFor="occ-finding" className="text-[13px] leading-snug font-normal text-ink">
                Create an action plan item for this finding (required for a not effective result)
              </Label>
            </div>
            {finding && (
              <Input value={findingTitle} onChange={(e) => setFindingTitle(e.target.value)} aria-label="Title of the action plan item"
                placeholder={`Control ${detail.activity.code} not effective (${o.period_label}): ${detail.activity.title}`} />
            )}
            {!detail.can_create_finding && <p className="text-[12px] text-alarm">Link the activity to a requirement first; the action plan item needs one.</p>}
          </div>
        )}
        {error && <ErrorState error={error} />}
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={invalid || save.isPending}>{save.isPending ? "Saving…" : "Save result"}</Button>
          {status === "Done" && !result && <span className="text-[12px] text-ink-3">Choose the result first.</span>}
        </div>
      </form>
    </Section>
  )
}
