import { useQueryClient } from "@tanstack/react-query"
import { Pill } from "@/components/common/basics"
import type { EntityBrief, UserBrief } from "@/lib/types"

export type ApprovalStatus = "pending" | "approved" | "rejected" | "changes_requested" | "withdrawn"
export type ApprovalState = ApprovalStatus | "none" | "changed_after_approval"
export type Decision = "approved" | "rejected" | "changes_requested"

export interface Approval {
  id: number
  target_type: string
  target_id: number
  target_label: string
  target_url: string | null
  target_version: string | null
  target_version_label: string | null
  entity: EntityBrief | null
  requested_by: UserBrief | null
  approver: UserBrief | null
  due_date: string | null
  status: ApprovalStatus
  request_note: string | null
  decision_note: string | null
  decided_at: string | null
  created_at: string
  meta: {
    above_appetite?: boolean
    requires_management_body?: boolean
    residual_level?: string
    appetite_level?: string
    transfer_only?: boolean
    acceptance_category?: string
  } | null
  overdue: boolean
  stale: boolean
  can_decide: boolean
  can_withdraw: boolean
  accessible: boolean
}

export interface TargetApprovals {
  state: ApprovalState
  current: Approval | null
  last_approved: Approval | null
  history: Approval[]
  current_version_label: string | null
  can_request: boolean
  noun: string
}

export interface ApprovalSummary { waiting: number; waiting_overdue: number; requested_pending: number }

export const STATE_LABEL: Record<ApprovalState, string> = {
  none: "Not requested",
  pending: "Approval pending",
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
  withdrawn: "Withdrawn",
  changed_after_approval: "Changed after approval",
}

const STATE_TONE: Record<ApprovalState, string> = {
  none: "neutral",
  pending: "brass",
  approved: "sage",
  rejected: "alarm",
  changes_requested: "amber",
  withdrawn: "outline",
  changed_after_approval: "amber",
}

export const DECISION_LABEL: Record<Decision, string> = {
  approved: "Approve",
  changes_requested: "Request changes",
  rejected: "Reject",
}

const TYPE_LABEL: Record<string, string> = {
  document: "Document",
  answer: "Assessment answer",
  risk_acceptance: "Risk acceptance",
  risk: "Risk",
  action_item: "Action plan item",
  work_package: "Work package",
  incident: "Incident",
  task: "Task",
  requirement: "Requirement",
}

export function targetTypeLabel(t: string) {
  return TYPE_LABEL[t] ?? t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
}

export function ApprovalStatePill({ state, className }: { state: ApprovalState; className?: string }) {
  return <Pill tone={STATE_TONE[state]} className={className}>{STATE_LABEL[state]}</Pill>
}

/** Effective state of one request (an approved request whose object changed reads "changed after approval"). */
export function requestState(a: Approval): ApprovalState {
  return a.status === "approved" && a.stale ? "changed_after_approval" : a.status
}

export function ManagementBodyFlag({ className }: { className?: string }) {
  return <Pill tone="alarm" className={className} title="The residual risk is above the risk appetite of the entity">Requires management body decision</Pill>
}

/** Invalidate every approval query (inbox, summaries, object panels). */
export function useInvalidateApprovals() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ["approvals"] })
}
