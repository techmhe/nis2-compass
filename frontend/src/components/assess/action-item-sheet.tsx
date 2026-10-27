import { useEffect, useState } from "react"
import { Link } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Code, EntityTag, ErrorState, KV, Loading, StatusPill } from "@/components/common/basics"
import { CommentsPanel, Confirm, DocumentLinks } from "@/components/common/collab"
import { Field, OptionSelect, StakeholderSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { ACTION_STATUS, PRIORITY_VALUES } from "@/lib/constants"
import { fromNow } from "@/lib/format"
import type { ActionItem } from "@/lib/types"
import type { ActionItemDetailResp } from "./shared"

interface Form {
  title: string
  priority: string
  status: string
  responsible_id: number | null
  target_date: string
  acceptance_criterion: string
  expected_evidence: string
  comments: string
}

const toForm = (i: ActionItem): Form => ({
  title: i.title, priority: i.priority, status: i.status, responsible_id: i.responsible?.id ?? null, target_date: i.target_date ?? "",
  acceptance_criterion: i.acceptance_criterion ?? "", expected_evidence: i.expected_evidence ?? "", comments: i.comments ?? "",
})

export function ActionItemSheet({ itemId, onClose }: { itemId: number | null; onClose: () => void }) {
  return (
    <Sheet open={itemId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[640px]">
        {itemId != null && <SheetBody key={itemId} itemId={itemId} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function SheetBody({ itemId, onClose }: { itemId: number; onClose: () => void }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ["action-item", itemId], queryFn: () => api.get<ActionItemDetailResp>(`/action-items/${itemId}`) })
  const [form, setForm] = useState<Form | null>(null)
  const item = q.data?.item
  useEffect(() => { if (item) setForm(toForm(item)) }, [item])

  const canEdit = !!item && can("findings.manage", item.entity.id)
  const dirty = !!item && !!form && JSON.stringify(toForm(item)) !== JSON.stringify(form)

  const save = useMutation({
    mutationFn: () => {
      const base = toForm(item!)
      const body: Record<string, unknown> = {}
      for (const k of Object.keys(form!) as (keyof Form)[]) {
        if (form![k] === base[k]) continue
        const v = form![k]
        body[k] = typeof v === "string" && k !== "title" && k !== "priority" && k !== "status" ? (v.trim() || null) : v
      }
      return api.patch<ActionItem>(`/action-items/${itemId}`, body)
    },
    onSuccess: (res) => {
      toast.success(`${res.code} saved`)
      qc.setQueryData<ActionItemDetailResp>(["action-item", itemId], (d) => (d ? { ...d, item: res } : d))
      qc.invalidateQueries({ queryKey: ["action-items"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const del = useMutation({
    mutationFn: () => api.del(`/action-items/${itemId}`),
    onSuccess: () => {
      toast.success(`${item?.code} deleted`)
      qc.invalidateQueries({ queryKey: ["action-items"] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (q.isLoading || (!form && !q.error)) return <><SheetHeader className="sr-only"><SheetTitle>Action item</SheetTitle></SheetHeader><Loading /></>
  if (q.error || !item || !form) {
    return (
      <div className="p-5">
        <SheetHeader className="p-0"><SheetTitle>Action item</SheetTitle></SheetHeader>
        <ErrorState error={q.error ?? "Not found"} className="mt-3" />
      </div>
    )
  }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))
  const workspaceLink = q.data?.assessment_id ? `/assessments/${q.data.assessment_id}?req=${item.requirement.id}` : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="border-b px-5 py-4 pr-12">
        <div className="flex items-center gap-2">
          <Code className="text-[13px] font-medium text-ink">{item.code}</Code>
          <EntityTag code={item.entity.code} name={item.entity.name} />
          <StatusPill value={item.status} />
          {item.due_status && <StatusPill value={item.due_status} />}
        </div>
        <SheetTitle className="text-[16px] leading-snug">{item.title}</SheetTitle>
        <SheetDescription className="text-[12.5px]">Updated {fromNow(item.updated_at)}</SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto scroll-thin px-5 py-4">
        <section className="rounded-md border bg-surface px-3 py-1">
          <KV label="Requirement">
            <Link to={`/catalog/${item.requirement.id}`} className="hover:text-petrol"><Code>{item.requirement.number}</Code> {item.requirement.section.replace(/^[\d.]+\s*/, "")}</Link>
          </KV>
          <KV label="Chapter">{item.chapter}</KV>
          <KV label="Finding">
            {item.finding_id ? (workspaceLink ? <Link to={workspaceLink} className="text-petrol hover:underline"><Code className="text-petrol">{item.finding_id}</Code></Link> : <Code>{item.finding_id}</Code>)
              : workspaceLink ? <Link to={workspaceLink} className="text-petrol hover:underline">Open answer</Link> : null}
          </KV>
          <KV label="Identified gap">{item.identified_gap}</KV>
          <KV label="Assessment owner">{item.assessment_owner}</KV>
          <KV label="Work packages">
            {item.work_packages.length ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {item.work_packages.map((w) => <Link key={w.id} to={`/work-packages/${w.id}`} className="hover:text-petrol"><Code>{w.code}</Code> {w.title}</Link>)}
              </span>
            ) : <span className="text-ink-3">Not linked to a work package</span>}
          </KV>
        </section>

        <section className="space-y-3">
          <Field label="Title" htmlFor="ai-title">
            <Textarea id="ai-title" rows={2} value={form.title} onChange={(e) => set("title", e.target.value)} disabled={!canEdit} className="text-[13px]" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status"><OptionSelect value={form.status} onChange={(v) => v && set("status", v)} options={ACTION_STATUS} disabled={!canEdit} /></Field>
            <Field label="Priority"><OptionSelect value={form.priority} onChange={(v) => v && set("priority", v)} options={PRIORITY_VALUES} disabled={!canEdit} /></Field>
            <Field label="Responsible"><StakeholderSelect value={form.responsible_id} onChange={(v) => set("responsible_id", v)} disabled={!canEdit} /></Field>
            <Field label="Target date" htmlFor="ai-target"><Input id="ai-target" type="date" value={form.target_date} onChange={(e) => set("target_date", e.target.value)} disabled={!canEdit} /></Field>
          </div>
          <Field label="Acceptance criterion" htmlFor="ai-acc">
            <Textarea id="ai-acc" rows={2} value={form.acceptance_criterion} onChange={(e) => set("acceptance_criterion", e.target.value)} disabled={!canEdit} className="text-[13px]"
              placeholder="When is this item done?" />
          </Field>
          <Field label="Expected evidence" htmlFor="ai-ev">
            <Textarea id="ai-ev" rows={2} value={form.expected_evidence} onChange={(e) => set("expected_evidence", e.target.value)} disabled={!canEdit} className="text-[13px]"
              placeholder="Documents or records that prove completion" />
          </Field>
          <Field label="Comments" htmlFor="ai-comments">
            <Textarea id="ai-comments" rows={2} value={form.comments} onChange={(e) => set("comments", e.target.value)} disabled={!canEdit} className="text-[13px]" />
          </Field>
        </section>

        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">Documents</h3>
          <DocumentLinks targetType="action_item" targetId={item.id} documents={q.data?.documents ?? []} entityId={item.entity.id} canEdit={canEdit}
            onChange={() => qc.invalidateQueries({ queryKey: ["action-item", itemId] })} />
        </section>

        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">Discussion</h3>
          <CommentsPanel targetType="action_item" targetId={item.id} canComment={canEdit} />
        </section>
      </div>

      {canEdit && (
        <div className="flex items-center gap-2 border-t bg-card px-5 py-3">
          <Confirm title={`Delete ${item.code}?`} description={item.work_packages.length ? "This item is linked to a work package. Unlink it there first." : "The item, its comments and document links are removed. The assessment finding stays."}
            confirmLabel="Delete item" onConfirm={() => del.mutate()}
            trigger={<Button variant="ghost" className="text-alarm hover:bg-alarm-50 hover:text-alarm" disabled={del.isPending}><Trash2 /> Delete</Button>} />
          <span className="ml-auto text-[12px] text-ink-3">{dirty ? "Unsaved changes" : ""}</span>
          <Button variant="outline" disabled={!dirty} onClick={() => setForm(toForm(item))}>Discard</Button>
          <Button disabled={!dirty || !form.title.trim() || save.isPending} onClick={() => save.mutate()}>Save changes</Button>
        </div>
      )}
    </div>
  )
}
