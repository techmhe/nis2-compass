import { useState, type ReactNode } from "react"
import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { History, Stamp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ErrorState, Loading, Section } from "@/components/common/basics"
import { Markdown } from "@/components/common/collab"
import { api, ApiError } from "@/lib/api"
import { fmtDate, fmtDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { DecisionButtons, RequestApprovalDialog, useWithdraw } from "./dialogs"
import { ApprovalStatePill, ManagementBodyFlag, requestState, type Approval, type TargetApprovals } from "./shared"

/**
 * Approval state, actions and history of one object (4-eyes principle).
 *
 * Props:
 * - targetType: "document" | "answer" | "risk_acceptance" | any comment/link target type (e.g. "action_item")
 * - targetId: id of the object
 * - entityId: entity of the object (optional; refetches when the object moves to another entity)
 * - title / requestLabel: override the section title and the request button label
 * - requestDisabledReason: when set, the request button is disabled and the reason shown (e.g. missing fields)
 * - notice: extra content shown inside the request dialog (e.g. a management body warning)
 * - onChanged: called after a request, decision or withdrawal (refresh the host object, e.g. document status)
 * - bare: render without the Section frame (for embedding into an existing panel)
 */
export function ApprovalPanel({ targetType, targetId, entityId, title = "Approval", requestLabel = "Request approval", requestDisabledReason, notice, onChanged, bare }: {
  targetType: string
  targetId: number
  entityId?: number | null
  title?: string
  requestLabel?: string
  requestDisabledReason?: string | null
  notice?: ReactNode
  onChanged?: () => void
  bare?: boolean
}) {
  const [requestOpen, setRequestOpen] = useState(false)
  const q = useQuery({
    queryKey: ["approvals", "target", targetType, targetId, entityId ?? null],
    queryFn: () => api.get<TargetApprovals>("/approvals/target", { target_type: targetType, target_id: targetId }),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  })
  const withdraw = useWithdraw(onChanged)

  if (q.error instanceof ApiError && q.error.status === 403) return null
  const body = q.isLoading ? <Loading className="p-0" /> : q.error ? <ErrorState error={q.error} /> : q.data ? (
    <PanelBody data={q.data} requestLabel={requestLabel} requestDisabledReason={requestDisabledReason}
      onRequest={() => setRequestOpen(true)} onWithdraw={(id) => withdraw.mutate(id)} withdrawing={withdraw.isPending} onChanged={onChanged} />
  ) : null

  return (
    <>
      {bare ? body : <Section title={<span className="inline-flex items-center gap-2"><Stamp className="size-4 text-ink-3" />{title}</span>}>{body}</Section>}
      {q.data && (
        <RequestApprovalDialog open={requestOpen} onOpenChange={setRequestOpen} targetType={targetType} targetId={targetId}
          noun={q.data.noun} title={requestLabel} notice={notice} onDone={() => onChanged?.()} />
      )}
    </>
  )
}

function PanelBody({ data, requestLabel, requestDisabledReason, onRequest, onWithdraw, withdrawing, onChanged }: {
  data: TargetApprovals
  requestLabel: string
  requestDisabledReason?: string | null
  onRequest: () => void
  onWithdraw: (id: number) => void
  withdrawing: boolean
  onChanged?: () => void
}) {
  const cur = data.current
  const earlier = data.history.filter((h) => h.id !== cur?.id)
  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <ApprovalStatePill state={data.state} />
        {cur?.meta?.requires_management_body && cur.status === "pending" && <ManagementBodyFlag />}
        {cur?.overdue && <span className="text-[12px] font-medium text-alarm">Overdue since {fmtDate(cur.due_date)}</span>}
      </div>

      <StateText data={data} />

      {cur?.request_note && cur.status === "pending" && (
        <blockquote className="border-l-2 pl-3 text-[12.5px] text-ink-2"><Markdown className="prose-md text-[12.5px]">{cur.request_note}</Markdown></blockquote>
      )}
      {cur?.decision_note && cur.status !== "pending" && (
        <blockquote className={cn("border-l-2 pl-3 text-[12.5px] text-ink-2", cur.status === "rejected" ? "border-alarm" : cur.status === "changes_requested" ? "border-amber" : "border-sage")}>
          <Markdown className="prose-md text-[12.5px]">{cur.decision_note}</Markdown>
        </blockquote>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {cur?.can_decide && <DecisionButtons approval={cur} onDone={() => onChanged?.()} />}
        {cur?.can_withdraw && (
          <Button size="sm" variant="outline" disabled={withdrawing} onClick={() => onWithdraw(cur.id)}>Withdraw request</Button>
        )}
        {data.can_request && (
          <Button size="sm" variant={data.state === "approved" ? "outline" : "default"} onClick={onRequest} disabled={!!requestDisabledReason}>
            <Stamp /> {data.state === "none" || data.state === "withdrawn" ? requestLabel : `${requestLabel} again`}
          </Button>
        )}
      </div>
      {data.can_request && requestDisabledReason && <p className="text-[12px] text-ink-3">{requestDisabledReason}</p>}

      {earlier.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <button className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 hover:text-ink">
              <History className="size-3.5" /> {earlier.length} earlier request{earlier.length === 1 ? "" : "s"}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-2 space-y-2 border-l pl-3">
              {earlier.map((h) => <HistoryItem key={h.id} a={h} />)}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

function StateText({ data }: { data: TargetApprovals }) {
  const cur = data.current
  const noun = data.noun
  if (!cur) {
    return <p className="text-ink-3">No approval has been requested for this {noun} yet. Ask a second person to approve it (4-eyes principle).</p>
  }
  const req = cur.requested_by?.display_name ?? "Unknown"
  const appr = cur.approver?.display_name ?? "Unknown"
  const ver = cur.target_version_label ? <span className="tabular text-ink">{cur.target_version_label}</span> : null
  switch (data.state) {
    case "pending":
      return (
        <p className="text-ink-2">
          {req} asked <span className="font-medium text-ink">{appr}</span> on {fmtDate(cur.created_at)} to approve {ver ?? `this ${noun}`}
          {cur.due_date ? <>, due {fmtDate(cur.due_date)}</> : null}.
        </p>
      )
    case "approved":
      return <p className="text-ink-2">Approved by <span className="font-medium text-ink">{appr}</span> on {fmtDate(cur.decided_at)}{ver ? <> ({ver})</> : null}, requested by {req}.</p>
    case "changed_after_approval":
      return (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-[12.5px] text-amber">
          {appr} approved {ver ?? "an earlier state"} on {fmtDate(cur.decided_at)}. The {noun} has changed since
          {data.current_version_label ? <> (now {data.current_version_label})</> : null}. Request a new approval.
        </p>
      )
    case "rejected":
      return <p className="text-ink-2">Rejected by <span className="font-medium text-ink">{appr}</span> on {fmtDate(cur.decided_at)}{ver ? <> ({ver})</> : null}.</p>
    case "changes_requested":
      return <p className="text-ink-2"><span className="font-medium text-ink">{appr}</span> requested changes on {fmtDate(cur.decided_at)}{ver ? <> ({ver})</> : null}. Revise it and request approval again.</p>
    default:
      return null
  }
}

function HistoryItem({ a }: { a: Approval }) {
  return (
    <li className="text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <ApprovalStatePill state={requestState(a)} />
        {a.target_version_label && <span className="tabular text-ink-2">{a.target_version_label}</span>}
        <span className="text-ink-3" title={fmtDateTime(a.decided_at ?? a.created_at)}>{fmtDate(a.decided_at ?? a.created_at)}</span>
      </div>
      <div className="mt-0.5 text-ink-3">
        {a.requested_by?.display_name ?? "Unknown"} asked {a.approver?.display_name ?? "Unknown"}
        {a.decision_note ? <>: <span className="text-ink-2">{a.decision_note}</span></> : null}
      </div>
    </li>
  )
}

/** Small link to the approval inbox entry of a request. */
export function ApprovalLink({ approval, children }: { approval: Approval; children?: ReactNode }) {
  return <Link to={`/approvals?request=${approval.id}`} className="text-petrol hover:underline">{children ?? "Open request"}</Link>
}
