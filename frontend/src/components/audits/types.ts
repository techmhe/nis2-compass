/** Types and labels of the audits & reviews module (API: /api/audits/*). */

export interface EntityRef { id: number; code: string; name: string; country: string | null }
export interface RequirementRef { id: number; number: string; section: string }
export interface DocLinkRow {
  link_id: number
  document_id: number
  title: string
  doc_type: string
  status: string
  version_label: string | null
  filename: string | null
  note: string | null
}

export interface AuditProgramme {
  id: number
  year: number
  title: string
  scope: string | null
  approved_by: string | null
  approved_on: string | null
  can_edit: boolean
}

export type AuditType = "internal" | "external" | "certification" | "supplier" | "authority"
export type AuditStatus = "planned" | "in_progress" | "reported" | "closed"

export interface Audit {
  id: number
  code: string
  programme_id: number | null
  programme_title: string | null
  type: AuditType
  entity: EntityRef | null
  entity_id: number | null
  scope: string
  requirement_chapter: string | null
  lead_auditor_id: number | null
  lead_auditor_name: string | null
  auditors: string | null
  planned_start: string
  planned_end: string
  actual_start: string | null
  actual_end: string | null
  status: AuditStatus
  summary: string | null
  conclusion: string | null
  has_open_findings: boolean
  created_at: string
  can_edit: boolean
  findings?: AuditFinding[]
  documents?: DocLinkRow[]
}

export type FindingType = "major_nonconformity" | "minor_nonconformity" | "observation" | "opportunity"
export type FindingStatus = "open" | "action_planned" | "closed"

export interface AuditFinding {
  id: number
  audit_id: number
  audit_code: string
  number: string
  type: FindingType
  description: string
  requirement_id: number | null
  requirement: RequirementRef | null
  entity: EntityRef | null
  entity_id: number | null
  status: FindingStatus
  due_date: string | null
  action_item_id: number | null
  closure_note: string | null
  closed_at: string | null
  closed_by: string | null
  can_edit: boolean
}

export type EffectivenessRating = "effective" | "partially_effective" | "not_effective" | "not_assessed"
export type ReviewStatus = "draft" | "in_review" | "approved"

export interface EffectivenessRow { chapter: number; rating: EffectivenessRating; rationale: string | null }

export interface CollectedInputs {
  entity_id: number | null
  generated_at: string
  gap: { coverage: number | null; average_score: number | null; work_packages: number } | null
  action_plan: { open: number; overdue: number }
  kpis_off_target: number
  incidents_last_12_months: number
  audit_findings_open: number
}

export interface EffectivenessReview {
  id: number
  entity: EntityRef | null
  entity_id: number | null
  period: string
  status: ReviewStatus
  rows: EffectivenessRow[]
  inputs_summary: CollectedInputs | null
  conclusion: string | null
  approved_at: string | null
  approved_by: string | null
  created_at: string
  can_edit: boolean
  approval: string
  documents?: DocLinkRow[]
}

export interface ManagementReviewInput { key: string; notes: string | null }
export interface ManagementReviewDecision { text: string; owner: string | null; due: string | null; task_id: number | null }

export interface ManagementReview {
  id: number
  date: string
  entity: EntityRef | null
  entity_id: number | null
  participants: string | null
  inputs: ManagementReviewInput[]
  decisions: ManagementReviewDecision[]
  board_decision_id: number | null
  created_at: string
  can_edit: boolean
  documents?: DocLinkRow[]
}

export interface InputChecklistItem { key: string; label: string }

/* ---------- labels ---------- */

export const AUDIT_TYPES: { value: AuditType; label: string }[] = [
  { value: "internal", label: "Internal" },
  { value: "external", label: "External" },
  { value: "certification", label: "Certification" },
  { value: "supplier", label: "Supplier" },
  { value: "authority", label: "Authority" },
]
export const AUDIT_TYPE_LABEL: Record<string, string> = Object.fromEntries(AUDIT_TYPES.map((t) => [t.value, t.label]))

export const AUDIT_STATUS: { value: AuditStatus; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In progress" },
  { value: "reported", label: "Reported" },
  { value: "closed", label: "Closed" },
]
export const AUDIT_STATUS_LABEL: Record<string, string> = Object.fromEntries(AUDIT_STATUS.map((s) => [s.value, s.label]))

export const FINDING_TYPES: { value: FindingType; label: string }[] = [
  { value: "major_nonconformity", label: "Major nonconformity" },
  { value: "minor_nonconformity", label: "Minor nonconformity" },
  { value: "observation", label: "Observation" },
  { value: "opportunity", label: "Opportunity for improvement" },
]
export const FINDING_TYPE_LABEL: Record<string, string> = Object.fromEntries(FINDING_TYPES.map((t) => [t.value, t.label]))

export const FINDING_STATUS_LABEL: Record<string, string> = { open: "Open", action_planned: "Action planned", closed: "Closed" }

export const EFFECTIVENESS_RATINGS: { value: EffectivenessRating; label: string }[] = [
  { value: "effective", label: "Effective" },
  { value: "partially_effective", label: "Partially effective" },
  { value: "not_effective", label: "Not effective" },
  { value: "not_assessed", label: "Not assessed" },
]
export const EFFECTIVENESS_LABEL: Record<string, string> = Object.fromEntries(EFFECTIVENESS_RATINGS.map((r) => [r.value, r.label]))

export const REVIEW_STATUS_LABEL: Record<string, string> = { draft: "Draft", in_review: "In review", approved: "Approved" }
