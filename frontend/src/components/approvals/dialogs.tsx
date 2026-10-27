import { useState, type ReactNode } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { addDays } from "date-fns"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ErrorState } from "@/components/common/basics"
import { Combo, Field } from "@/components/common/fields"
import { api } from "@/lib/api"
import { isoDate } from "@/lib/format"
import type { UserBrief } from "@/lib/types"
import { DECISION_LABEL, type Approval, type Decision, useInvalidateApprovals } from "./shared"

/** Ask a second person to approve an object (4-eyes principle). */
export function RequestApprovalDialog({ open, onOpenChange, targetType, targetId, noun, title = "Request approval", description, notice, onDone }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  targetType: string
  targetId: number
  noun: string
  title?: string
  description?: ReactNode
  notice?: ReactNode
  onDone?: (a: Approval) => void
}) {
  const invalidate = useInvalidateApprovals()
  const [approver, setApprover] = useState<number | null>(null)
  const [due, setDue] = useState(isoDate(addDays(new Date(), 7)))
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const approvers = useQuery({
    queryKey: ["approvals", "approvers", targetType, targetId],
    queryFn: () => api.get<UserBrief[]>("/approvals/approvers", { target_type: targetType, target_id: targetId }),
    enabled: open,
  })
  const submit = useMutation({
    mutationFn: () => api.post<Approval>("/approvals", {
      target_type: targetType, target_id: targetId, approver_user_id: approver, due_date: due || null,
      request_note: note.trim() || null,
    }),
    onMutate: () => setError(null),
    onSuccess: (a) => {
      toast.success(`Approval requested from ${a.approver?.display_name ?? "the approver"}`)
      invalidate()
      onOpenChange(false)
      setApprover(null); setNote("")
      onDone?.(a)
    },
    onError: (e: Error) => setError(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setError(null) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ?? `The approver is notified and approves, rejects or requests changes. The current version of the ${noun} is recorded with the approval.`}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (approver) submit.mutate() }}>
          {notice}
          <Field label="Approver" hint="Only people with access to this object are listed. You cannot approve your own request.">
            <Combo value={approver} onChange={setApprover} placeholder={approvers.isLoading ? "Loading people…" : "Choose the approver…"}
              searchPlaceholder="Search name or e-mail" allowNone={false}
              items={(approvers.data ?? []).map((u) => ({ value: u.id, label: u.display_name, hint: u.email }))} />
          </Field>
          <Field label="Due date" htmlFor="appr-due">
            <Input id="appr-due" type="date" value={due} min={isoDate(new Date())} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Note to the approver" htmlFor="appr-note">
            <Textarea id="appr-note" rows={3} value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)}
              placeholder="What changed, what should be checked, which decision is needed" />
          </Field>
          {approvers.error && <ErrorState error={approvers.error} />}
          {error && <ErrorState error={error} />}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!approver || submit.isPending}>{submit.isPending ? "Sending…" : "Send request"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Approve, reject or request changes; a note is required unless approving. */
export function DecisionDialog({ approval, decision, open, onOpenChange, onDone }: {
  approval: Approval
  decision: Decision
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone?: (a: Approval) => void
}) {
  const invalidate = useInvalidateApprovals()
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const noteRequired = decision !== "approved"
  const submit = useMutation({
    mutationFn: () => api.post<Approval>(`/approvals/${approval.id}/decide`, { decision, note: note.trim() || null }),
    onMutate: () => setError(null),
    onSuccess: (a) => {
      toast.success(decision === "approved" ? "Approved" : decision === "rejected" ? "Rejected" : "Changes requested")
      invalidate()
      onOpenChange(false)
      setNote("")
      onDone?.(a)
    },
    onError: (e: Error) => setError(e.message),
  })
  const verb = DECISION_LABEL[decision]
  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setError(null) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{verb}: {approval.target_label}</DialogTitle>
          <DialogDescription>
            {decision === "approved"
              ? `You approve ${approval.target_version_label ?? "the current version"} as requested by ${approval.requested_by?.display_name ?? "the requester"}.`
              : `${approval.requested_by?.display_name ?? "The requester"} is notified. Explain what needs to change.`}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!noteRequired || note.trim()) submit.mutate() }}>
          {approval.meta?.requires_management_body && (
            <p className="rounded-md bg-alarm-50 px-3 py-2 text-[12.5px] text-alarm">
              The residual risk is above the risk appetite. Only approve if you decide on behalf of the management body, or record the board decision in the note.
            </p>
          )}
          <Field label={noteRequired ? "Reason (required)" : "Note (optional)"} htmlFor="dec-note">
            <Textarea id="dec-note" rows={4} value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} autoFocus
              placeholder={noteRequired ? "What has to change before you can approve" : "e.g. reference to the board minutes"} />
          </Field>
          {error && <ErrorState error={error} />}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant={decision === "rejected" ? "destructive" : "default"} disabled={submit.isPending || (noteRequired && !note.trim())}>
              {submit.isPending ? "Saving…" : verb}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Approve / request changes / reject buttons that open the decision dialog. */
export function DecisionButtons({ approval, size = "sm", onDone }: { approval: Approval; size?: "sm" | "xs" | "default"; onDone?: (a: Approval) => void }) {
  const [decision, setDecision] = useState<Decision | null>(null)
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <Button size={size} onClick={() => setDecision("approved")}>Approve</Button>
        <Button size={size} variant="outline" onClick={() => setDecision("changes_requested")}>Request changes</Button>
        <Button size={size} variant="outline" className="text-alarm hover:text-alarm" onClick={() => setDecision("rejected")}>Reject</Button>
      </div>
      {decision && (
        <DecisionDialog approval={approval} decision={decision} open={!!decision} onOpenChange={(v) => { if (!v) setDecision(null) }} onDone={onDone} />
      )}
    </>
  )
}

/** Withdraw a pending request (requester only). */
export function useWithdraw(onDone?: () => void) {
  const invalidate = useInvalidateApprovals()
  return useMutation({
    mutationFn: (id: number) => api.post<Approval>(`/approvals/${id}/withdraw`),
    onSuccess: () => { toast.success("Request withdrawn"); invalidate(); onDone?.() },
    onError: (e: Error) => toast.error(e.message),
  })
}
