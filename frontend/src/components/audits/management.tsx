import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardList, ListChecks, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Empty, EntityTag, ErrorState, Loading, Section } from "@/components/common/basics"
import { Confirm, DocumentLinks } from "@/components/common/collab"
import { EntitySelect, Field, UserSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate, isoDate } from "@/lib/format"
import { EntityFilter, GroupPill, auditKeys, invalidateAudits } from "./shared"
import { type InputChecklistItem, type ManagementReview, type ManagementReviewDecision, type ManagementReviewInput } from "./types"

function useMgmtReviews(entity: number | null) {
  return useQuery({ queryKey: auditKeys.mgmtReviews, queryFn: () => api.get<ManagementReview[]>("/audits/management-reviews", entity != null ? { entity_id: entity } : undefined) })
}

function useChecklist() {
  return useQuery({ queryKey: auditKeys.inputChecklist, queryFn: () => api.get<InputChecklistItem[]>("/audits/management-reviews/input-checklist"), staleTime: 10 * 60_000 })
}

/* ---------- create / edit ---------- */

interface Form {
  date: string; entity_id: number | null; participants: string
  inputs: Record<string, string>
  decisions: ManagementReviewDecision[]
}

function toForm(m: ManagementReview | null, checklist: InputChecklistItem[]): Form {
  const inputs: Record<string, string> = {}
  for (const c of checklist) inputs[c.key] = m?.inputs.find((i) => i.key === c.key)?.notes ?? ""
  return { date: m?.date ?? isoDate(new Date()), entity_id: m?.entity_id ?? null, participants: m?.participants ?? "",
    inputs, decisions: m?.decisions ?? [] }
}

function ReviewDialog({ open, onOpenChange, review, defaultEntity }: {
  open: boolean; onOpenChange: (o: boolean) => void; review?: ManagementReview | null; defaultEntity: number | null
}) {
  const qc = useQueryClient()
  const { can, canGlobal } = useAuth()
  const checklist = useChecklist()
  const [f, setF] = useState<Form>(() => toForm(null, []))
  const [newDecision, setNewDecision] = useState({ text: "", owner: "", due: "" })
  useEffect(() => { if (open) setF(toForm(review ?? { entity_id: defaultEntity } as ManagementReview, checklist.data ?? [])) }, [open, review, defaultEntity, checklist.data])
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const allowed = f.entity_id == null ? canGlobal("audits.manage") : can("audits.manage", f.entity_id)
  const valid = f.date && allowed
  const addDecision = () => {
    if (!newDecision.text.trim()) return
    set("decisions", [...f.decisions, { text: newDecision.text.trim(), owner: newDecision.owner.trim() || null, due: newDecision.due || null, task_id: null }])
    setNewDecision({ text: "", owner: "", due: "" })
  }
  const removeDecision = (i: number) => set("decisions", f.decisions.filter((_, x) => x !== i))
  const save = useMutation({
    mutationFn: () => {
      const body = {
        date: f.date, entity_id: f.entity_id, participants: f.participants.trim() || null,
        inputs: Object.entries(f.inputs).filter(([, v]) => v.trim()).map(([key, notes]) => ({ key, notes: notes.trim() })),
        decisions: f.decisions,
      }
      return review ? api.put<ManagementReview>(`/audits/management-reviews/${review.id}`, body) : api.post<ManagementReview>("/audits/management-reviews", body)
    },
    onSuccess: () => { toast.success(review ? "Review saved" : "Management review recorded"); invalidateAudits(qc); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{review ? "Edit management review" : "New management review"}</DialogTitle>
          <DialogDescription>ISO/IEC 27001:2022 9.3 management review inputs and decisions.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto scroll-thin pr-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="mr-date"><Input id="mr-date" type="date" max={isoDate(new Date())} value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
            <Field label="Entity"><EntitySelect value={f.entity_id} onChange={(v) => set("entity_id", v)} groupLabel="Group-wide" /></Field>
            <Field label="Participants" className="col-span-2" htmlFor="mr-part"><Input id="mr-part" value={f.participants} onChange={(e) => set("participants", e.target.value)} /></Field>
          </div>
          <div>
            <h3 className="mb-2 text-[13px] font-semibold">Inputs (ISO 9.3.2 a–i)</h3>
            <ul className="space-y-2">
              {(checklist.data ?? []).map((c) => (
                <li key={c.key} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2">
                  <span className="pt-1.5 font-mono text-[11.5px] text-ink-3">{c.key})</span>
                  <div>
                    <div className="mb-1 text-[12.5px] text-ink-2">{c.label}</div>
                    <Textarea rows={1} value={f.inputs[c.key] ?? ""} onChange={(e) => set("inputs", { ...f.inputs, [c.key]: e.target.value })} placeholder="Notes" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-[13px] font-semibold">Decisions / outputs</h3>
            <ul className="mb-2 space-y-1">
              {f.decisions.map((d, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate">{d.text}{d.owner ? ` — ${d.owner}` : ""}{d.due ? ` (due ${fmtDate(d.due)})` : ""}</span>
                  <button type="button" className="text-ink-3 hover:text-alarm" aria-label="Remove decision" onClick={() => removeDecision(i)}>×</button>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-[minmax(0,1fr)_120px_140px_auto] gap-2">
              <Input placeholder="Decision / output" value={newDecision.text} onChange={(e) => setNewDecision({ ...newDecision, text: e.target.value })} />
              <Input placeholder="Owner" value={newDecision.owner} onChange={(e) => setNewDecision({ ...newDecision, owner: e.target.value })} />
              <Input type="date" value={newDecision.due} onChange={(e) => setNewDecision({ ...newDecision, due: e.target.value })} />
              <Button type="button" size="sm" variant="outline" onClick={addDecision}><Plus /></Button>
            </div>
          </div>
        </div>
        {!allowed && <p className="text-[12.5px] text-alarm">You cannot manage reviews for the selected scope.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{review ? "Save changes" : "Record review"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- decision -> task ---------- */

function CreateTaskButton({ reviewId, index, decision }: { reviewId: number; index: number; decision: ManagementReviewDecision }) {
  const qc = useQueryClient()
  const [assigneeId, setAssigneeId] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const create = useMutation({
    mutationFn: () => api.post(`/audits/management-reviews/${reviewId}/decisions/${index}/create-task`, { assignee_id: assigneeId }),
    onSuccess: () => { toast.success("Task created"); invalidateAudits(qc); qc.invalidateQueries({ queryKey: auditKeys.mgmtReview(reviewId) }); setOpen(false) },
    onError: (e: Error) => toast.error(e.message),
  })
  if (decision.task_id) return <span className="text-[11.5px] text-sage">Task created</span>
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>Create task</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Create task from decision</DialogTitle><DialogDescription>{decision.text}</DialogDescription></DialogHeader>
          <Field label="Assignee"><UserSelect value={assigneeId} onChange={setAssigneeId} placeholder="Unassigned" /></Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending} onClick={() => create.mutate()}>Create task</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/* ---------- detail sheet ---------- */

function ReviewSheet({ reviewId, onClose, onEdit }: { reviewId: number | null; onClose: () => void; onEdit: (m: ManagementReview) => void }) {
  const qc = useQueryClient()
  const checklist = useChecklist()
  const q = useQuery({ queryKey: auditKeys.mgmtReview(reviewId ?? 0), queryFn: () => api.get<ManagementReview>(`/audits/management-reviews/${reviewId}`), enabled: reviewId != null })
  const del = useMutation({
    mutationFn: () => api.del(`/audits/management-reviews/${reviewId}`),
    onSuccess: () => { toast.success("Review deleted"); invalidateAudits(qc); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  const labels = new Map((checklist.data ?? []).map((c) => [c.key, c.label]))
  const m = q.data
  return (
    <Sheet open={reviewId != null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[640px]">
        {m && (
          <>
            <SheetHeader className="border-b px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">{m.entity ? <EntityTag code={m.entity.code} name={m.entity.name} /> : <GroupPill />}</div>
              <SheetTitle className="text-[16px]">Management review {fmtDate(m.date)}</SheetTitle>
              <SheetDescription>{m.participants}</SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-5 py-4">
              {m.can_edit && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(m)}>Edit</Button>
                  <Confirm title="Delete this review?" description="This cannot be undone." onConfirm={() => del.mutateAsync()}
                    trigger={<Button size="sm" variant="ghost" className="text-alarm hover:text-alarm"><Trash2 /> Delete</Button>} />
                </div>
              )}
              <Section title="Inputs">
                {!m.inputs.length ? <p className="text-[12.5px] text-ink-3">No inputs recorded.</p> : (
                  <ul className="space-y-2">
                    {m.inputs.map((i: ManagementReviewInput) => (
                      <li key={i.key} className="text-[12.5px]">
                        <div className="font-medium text-ink">{labels.get(i.key) ?? i.key}</div>
                        <div className="text-ink-2">{i.notes}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title="Decisions / outputs">
                {!m.decisions.length ? <p className="text-[12.5px] text-ink-3">No decisions recorded.</p> : (
                  <ul className="divide-y">
                    {m.decisions.map((d, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <div className="text-[13px] text-ink">{d.text}</div>
                          <div className="text-[12px] text-ink-3">{d.owner}{d.due ? ` · due ${fmtDate(d.due)}` : ""}</div>
                        </div>
                        {m.can_edit && <CreateTaskButton reviewId={m.id} index={i} decision={d} />}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <div>
                <h3 className="mb-2 text-[13px] font-semibold">Documents</h3>
                <DocumentLinks targetType="management_review" targetId={m.id} documents={m.documents ?? []} entityId={m.entity_id} canEdit={m.can_edit}
                  onChange={() => qc.invalidateQueries({ queryKey: auditKeys.mgmtReview(m.id) })} />
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ---------- main view ---------- */

export function ManagementReviewsView() {
  const { canAny } = useAuth()
  const [params, setParams] = useSearchParams()
  const [entity, setEntity] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ManagementReview | null>(null)
  const q = useMgmtReviews(entity)
  const canManage = canAny("audits.manage")

  const selectedId = Number(params.get("review")) || null
  const setSelected = (id: number | null) => setParams((p) => { if (id) p.set("review", String(id)); else p.delete("review"); return p }, { replace: true })
  const sorted = useMemo(() => [...(q.data ?? [])].sort((a, b) => b.date.localeCompare(a.date)), [q.data])

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState error={q.error} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <EntityFilter value={entity} onChange={setEntity} className="w-60" />
        {canManage && <Button className="ml-auto" onClick={() => setCreating(true)}><Plus /> New review</Button>}
      </div>
      {!sorted.length ? (
        <Section><Empty icon={<ClipboardList className="size-6" />} title="No management review recorded">
          ISO/IEC 27001:2022 9.3 requires management to review the ISMS at planned intervals.
        </Empty></Section>
      ) : (
        <Section bodyClassName="p-0">
          <ul className="divide-y">
            {sorted.map((m) => (
              <li key={m.id}>
                <button className="grid w-full grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-muted" onClick={() => setSelected(m.id)}>
                  <span className="tabular text-[12.5px] text-ink-3">{fmtDate(m.date)}</span>
                  <span className="flex items-center gap-2">
                    {m.entity ? <EntityTag code={m.entity.code} name={m.entity.name} /> : <GroupPill />}
                    <span className="truncate text-[13px] text-ink">{m.decisions.length} decision{m.decisions.length === 1 ? "" : "s"}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-3"><ListChecks className="size-3.5" /> {m.inputs.length} input{m.inputs.length === 1 ? "" : "s"}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <ReviewDialog open={creating || editing != null} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null) } }} review={editing} defaultEntity={entity} />
      <ReviewSheet reviewId={selectedId} onClose={() => setSelected(null)} onEdit={(m) => setEditing(m)} />
    </div>
  )
}
