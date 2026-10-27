import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus, ShieldOff, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Code, EntityTag, Empty, ErrorState, KV, Loading, Section } from "@/components/common/basics"
import { CommentsPanel, Confirm } from "@/components/common/collab"
import { EntitySelect, Field, OptionSelect, UserSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate, fmtDateTime, isoDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { RequirementPicker } from "./requirement-picker"
import { daysLabel, EXC_LABEL, ExceptionPill } from "./shared"
import type { ControlActivity, ControlException, ExceptionStatus } from "./types"

interface ExcList { items: ControlException[]; can_create: boolean }

const SCOPE_LABEL = { entity: "Entity", requirement: "Requirement", control: "Control activity" } as const

export function ExceptionsTab() {
  const { me } = useAuth()
  const [params, setParams] = useSearchParams()
  const selected = params.get("exception") ? Number(params.get("exception")) : null
  const [status, setStatus] = useState<string | null>(null)
  const [editing, setEditing] = useState<ControlException | "new" | null>(null)
  const list = useQuery({ queryKey: ["controls", "exceptions"], queryFn: () => api.get<ExcList>("/controls/exceptions") })
  const items = list.data?.items ?? []
  const rows = useMemo(() => items.filter((x) => !status || (status === "mine" ? x.can_decide : x.status === status)), [items, status])
  const mine = items.filter((x) => x.can_decide).length
  const open = (id: number | null) => setParams((p) => { if (id) p.set("exception", String(id)); else p.delete("exception"); return p })
  const current = items.find((x) => x.id === selected) ?? null

  return (
    <div>
      {mine > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-md border border-brass/40 bg-brass-50/60 px-4 py-2.5 text-[13px]">
          <span className="text-ink">{mine === 1 ? "One exception is" : `${mine} exceptions are`} waiting for your decision, {me?.display_name.split(" ")[0]}.</span>
          <Button size="xs" variant="outline" onClick={() => setStatus("mine")}>Show them</Button>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-56">
          <OptionSelect value={status} onChange={setStatus} allowNone noneLabel="All statuses" placeholder="All statuses"
            options={[{ value: "mine", label: "Waiting for my decision" },
              ...(Object.keys(EXC_LABEL) as ExceptionStatus[]).map((s) => ({ value: s, label: EXC_LABEL[s] }))]} />
        </div>
        <p className="flex-1 text-[12.5px] text-ink-3">Deviations from requirements or controls need compensating measures, a second person's approval and an expiry date.</p>
        {list.data?.can_create && <Button onClick={() => setEditing("new")}><Plus /> Request exception</Button>}
      </div>
      <div className="rounded-md border bg-card">
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} className="m-4" /> : items.length === 0 ? (
          <Empty title="No exceptions recorded" icon={<ShieldOff className="size-6" />}
            action={list.data?.can_create && <Button size="sm" onClick={() => setEditing("new")}><Plus /> Request exception</Button>}>
            Record here when a requirement or control cannot be met for a while, together with the compensating measures.
          </Empty>
        ) : rows.length === 0 ? <Empty title="No exception matches this filter" /> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[920px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">Exception</th>
                  <th className="px-2 py-2 font-medium">Entity</th>
                  <th className="px-2 py-2 font-medium">Applies to</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Approver</th>
                  <th className="px-2 py-2 pr-4 font-medium">Expires</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id} className={cn("cursor-pointer border-b align-top last:border-0 hover:bg-muted/50", selected === x.id && "bg-petrol-50/40")} onClick={() => open(x.id)}>
                    <td className="py-2 pr-2 pl-4">
                      <div className="flex items-baseline gap-2">
                        <Code className="shrink-0">{x.code}</Code>
                        <button type="button" className="text-left font-medium text-ink hover:text-petrol" onClick={(e) => { e.stopPropagation(); open(x.id) }}>{x.title}</button>
                      </div>
                    </td>
                    <td className="px-2 py-2">{x.entity ? <EntityTag code={x.entity.code} name={x.entity.name} /> : <span className="text-ink-3">Group</span>}</td>
                    <td className="px-2 py-2"><AppliesTo x={x} /></td>
                    <td className="px-2 py-2"><ExceptionPill status={x.status} /></td>
                    <td className="px-2 py-2 text-ink-2">{x.approver_name ?? "–"}</td>
                    <td className="tabular px-2 py-2 pr-4 whitespace-nowrap">
                      <div className="text-ink-2">{fmtDate(x.expires_at)}</div>
                      {(x.status === "approved" || x.status === "expired") && (
                        <div className={cn("text-[12px]", x.days_to_expiry < 0 ? "text-alarm" : x.days_to_expiry <= 30 ? "text-amber" : "text-ink-3")}>{daysLabel(x.days_to_expiry)}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Sheet open={selected != null} onOpenChange={(v) => { if (!v) open(null) }}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[600px]">
          {selected != null && (current ? <ExceptionBody x={current} onEdit={() => setEditing(current)} onDeleted={() => open(null)} /> : (
            <><SheetHeader><SheetTitle>Exception</SheetTitle><SheetDescription className="sr-only">Details</SheetDescription></SheetHeader>
              {list.isLoading ? <Loading /> : <ErrorState className="m-4" error="This exception does not exist or you have no access to it." />}</>
          ))}
        </SheetContent>
      </Sheet>
      {editing && <ExceptionDialog exc={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(x) => { setEditing(null); open(x.id) }} />}
    </div>
  )
}

function AppliesTo({ x }: { x: ControlException }) {
  if (x.scope_type === "requirement" && x.requirement) {
    return <span className="flex items-baseline gap-1.5"><Code>{x.requirement.number}</Code><span className="line-clamp-1 text-ink-2">{x.requirement.section.replace(/^[\d.]+\s*/, "")}</span></span>
  }
  if (x.scope_type === "control" && x.activity) return <span className="flex items-baseline gap-1.5"><Code>{x.activity.code}</Code><span className="line-clamp-1 text-ink-2">{x.activity.title}</span></span>
  return <span className="text-ink-2">{SCOPE_LABEL[x.scope_type]}</span>
}

function ExceptionBody({ x, onEdit, onDeleted }: { x: ControlException; onEdit: () => void; onDeleted: () => void }) {
  const qc = useQueryClient()
  const [note, setNote] = useState("")
  const done = (msg: string) => () => { toast.success(msg); qc.invalidateQueries({ queryKey: ["controls"] }) }
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") => api.post(`/controls/exceptions/${x.id}/decision`, { decision, note: note.trim() || null }),
    onSuccess: (_, d) => { setNote(""); done(d === "approve" ? "Exception approved" : "Exception rejected")() },
    onError: (e: Error) => toast.error(e.message),
  })
  const revoke = useMutation({ mutationFn: () => api.post(`/controls/exceptions/${x.id}/revoke`), onSuccess: done("Exception revoked"), onError: (e: Error) => toast.error(e.message) })
  const del = useMutation({
    mutationFn: () => api.del(`/controls/exceptions/${x.id}`),
    onSuccess: () => { done("Exception deleted")(); onDeleted() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <>
      <SheetHeader className="border-b px-5 py-4">
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3"><Code>{x.code}</Code>{x.entity && <EntityTag code={x.entity.code} name={x.entity.name} />}</div>
        <SheetTitle className="text-[17px] leading-snug">{x.title}</SheetTitle>
        <SheetDescription className="flex items-center gap-2"><ExceptionPill status={x.status} /><span>Expires {fmtDate(x.expires_at)}</span></SheetDescription>
        {x.can_edit && (
          <div className="flex flex-wrap gap-2 pt-1">
            {(x.status === "requested" || x.status === "approved") && <Button size="sm" variant="outline" onClick={onEdit}><Pencil /> Edit exception</Button>}
            {x.status === "approved" && (
              <Confirm title={`Revoke ${x.code}?`} description="The exception no longer applies. The record is kept." confirmLabel="Revoke exception"
                onConfirm={() => revoke.mutate()} trigger={<Button size="sm" variant="outline">Revoke</Button>} />
            )}
            {(x.status === "requested" || x.status === "rejected") && (
              <Confirm title={`Delete ${x.code}?`} description="The exception request is removed permanently." confirmLabel="Delete exception"
                onConfirm={() => del.mutate()} trigger={<Button size="sm" variant="outline" className="text-alarm"><Trash2 /> Delete</Button>} />
            )}
          </div>
        )}
      </SheetHeader>
      <div className="space-y-5 px-5 py-4">
        <div>
          <KV label="Applies to">{SCOPE_LABEL[x.scope_type]}</KV>
          {x.requirement && <KV label="Requirement"><Link to={`/catalog/${x.requirement.id}`} className="hover:text-petrol"><Code>{x.requirement.number}</Code> {x.requirement.section.replace(/^[\d.]+\s*/, "")}</Link></KV>}
          {x.activity && <KV label="Control"><Link to={`/controls/activities?activity=${x.activity.id}`} className="hover:text-petrol"><Code>{x.activity.code}</Code> {x.activity.title}</Link></KV>}
          <KV label="Reason"><span className="whitespace-pre-line">{x.reason}</span></KV>
          <KV label="Compensating measures">{x.compensating_measures ? <span className="whitespace-pre-line">{x.compensating_measures}</span> : null}</KV>
          <KV label="Requested by">{x.requested_by_name}{` on ${fmtDate(x.created_at)}`}</KV>
          <KV label="Approver">{x.approver_name}</KV>
          {x.decided_at && <KV label="Decision">{fmtDateTime(x.decided_at)}{x.decision_note ? `: ${x.decision_note}` : ""}</KV>}
        </div>
        {x.can_decide && (
          <Section title="Your decision">
            <div className="space-y-2">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Decision note" placeholder="Note (required when rejecting)" />
              <div className="flex gap-2">
                <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>Approve exception</Button>
                <Button size="sm" variant="outline" disabled={decide.isPending || !note.trim()} onClick={() => decide.mutate("reject")}>Reject exception</Button>
              </div>
            </div>
          </Section>
        )}
        <Section title="Comments"><CommentsPanel targetType="control_exception" targetId={x.id} canComment={x.can_edit || x.can_decide} /></Section>
      </div>
    </>
  )
}

function ExceptionDialog({ exc, onClose, onSaved }: { exc: ControlException | null; onClose: () => void; onSaved: (x: ControlException) => void }) {
  const qc = useQueryClient()
  const { can, me } = useAuth()
  const acts = useQuery({ queryKey: ["controls", "activities"], queryFn: () => api.get<{ items: ControlActivity[] }>("/controls/activities") })
  const [f, setF] = useState({
    title: exc?.title ?? "", scope_type: exc?.scope_type ?? "requirement", entity_id: exc?.entity?.id ?? null as number | null,
    requirement_id: exc?.requirement?.id ?? null as number | null, activity_id: exc?.activity?.id ?? null as number | null,
    reason: exc?.reason ?? "", compensating_measures: exc?.compensating_measures ?? "", approver_id: exc?.approver_id ?? null as number | null,
    expires_at: exc?.expires_at ?? isoDate(new Date(Date.now() + 180 * 86_400_000)),
  })
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, compensating_measures: f.compensating_measures.trim() || null,
        requirement_id: f.scope_type === "control" ? null : f.requirement_id, activity_id: f.scope_type === "control" ? f.activity_id : null }
      return exc ? api.put<ControlException>(`/controls/exceptions/${exc.id}`, body) : api.post<ControlException>("/controls/exceptions", body)
    },
    onMutate: () => setError(null),
    onSuccess: (x) => {
      toast.success(exc ? (x.status === "requested" && exc.status === "approved" ? "Saved; the approver has to confirm the changes" : "Exception saved") : `${x.code} sent to the approver`)
      qc.invalidateQueries({ queryKey: ["controls"] })
      onSaved(x)
    },
    onError: (e: Error) => setError(e.message),
  })
  const groupOk = can("controls.manage")
  const invalid = !f.title.trim() || !f.reason.trim() || !f.approver_id || !f.expires_at
    || (f.scope_type === "requirement" && !f.requirement_id) || (f.scope_type === "control" && !f.activity_id)
    || ((f.scope_type === "entity" || !groupOk) && !f.entity_id)
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{exc ? `Edit ${exc.code}` : "Request exception"}</DialogTitle>
          <DialogDescription>The approver must be another person. Changing an approved exception sends it back for approval.</DialogDescription>
        </DialogHeader>
        <form id="exc-form" className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate() }}>
          <Field label="Title" className="sm:col-span-2" htmlFor="exc-title">
            <Input id="exc-title" autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={300} placeholder="e.g. Legacy HMI workstations without MFA" />
          </Field>
          <Field label="Applies to">
            <OptionSelect value={f.scope_type} onChange={(v) => set("scope_type", (v ?? "requirement") as typeof f.scope_type)}
              options={(Object.keys(SCOPE_LABEL) as (keyof typeof SCOPE_LABEL)[]).map((k) => ({ value: k, label: SCOPE_LABEL[k] }))} />
          </Field>
          <Field label="Entity" hint={groupOk ? "Leave empty for a group-wide exception" : undefined}>
            <EntitySelect value={f.entity_id} onChange={(v) => set("entity_id", v)} allowGroup={groupOk && f.scope_type !== "entity"} groupLabel="Group-wide" />
          </Field>
          {f.scope_type !== "control" && (
            <Field label={f.scope_type === "entity" ? "Requirement (optional)" : "Requirement"} className="sm:col-span-2">
              <RequirementPicker single value={f.requirement_id ? [f.requirement_id] : []} onChange={(v) => set("requirement_id", v[0] ?? null)} />
            </Field>
          )}
          {f.scope_type === "control" && (
            <Field label="Control activity" className="sm:col-span-2">
              <OptionSelect value={f.activity_id ? String(f.activity_id) : null} onChange={(v) => set("activity_id", v ? Number(v) : null)} placeholder="Choose activity…"
                options={(acts.data?.items ?? []).map((a) => ({ value: String(a.id), label: `${a.code} ${a.title}` }))} />
            </Field>
          )}
          <Field label="Reason" className="sm:col-span-2" htmlFor="exc-reason">
            <Textarea id="exc-reason" rows={3} value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Why the requirement or control cannot be met" />
          </Field>
          <Field label="Compensating measures" className="sm:col-span-2" htmlFor="exc-comp">
            <Textarea id="exc-comp" rows={3} value={f.compensating_measures} onChange={(e) => set("compensating_measures", e.target.value)} placeholder="What reduces the risk in the meantime" />
          </Field>
          <Field label="Approver">
            <UserSelect value={f.approver_id} onChange={(v) => set("approver_id", v)} placeholder="Who approves?" />
            {f.approver_id === me?.id && <p className="text-[12px] text-alarm">You cannot approve your own request.</p>}
          </Field>
          <Field label="Expires on" htmlFor="exc-exp" hint="At most three years">
            <Input id="exc-exp" type="date" value={f.expires_at} min={isoDate(new Date(Date.now() + 86_400_000))} onChange={(e) => set("expires_at", e.target.value)} />
          </Field>
          {error && <ErrorState className="sm:col-span-2" error={error} />}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="exc-form" disabled={invalid || f.approver_id === me?.id || save.isPending}>
            {save.isPending ? "Saving…" : exc ? "Save changes" : "Send for approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
