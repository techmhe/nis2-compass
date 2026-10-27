/** Types and labels of the governance module (API: /api/governance/*). */

export interface EntityRef { id: number; code: string; name: string; country: string | null }

export type LegalStatus = "binding" | "benchmark" | "guidance"

export interface LegalTag {
  id: number
  requirement_id: number
  jurisdiction: "DE" | "NL" | "EU"
  status: LegalStatus
  basis_provision_id: number | null
  basis_label: string | null
  note: string | null
  is_auto: boolean
  regulation_id: number | null
  regulation_code: string | null
}

export interface RequirementLegalResp {
  rows: LegalTag[]
  entities: { entity: EntityRef; effective: LegalTag | null }[]
  can_edit: boolean
}

export interface EntityLegalResp {
  entity: EntityRef
  ir_2024_2690_applicable: boolean
  items: LegalTag[]
}

export interface EntityProfile {
  entity: EntityRef
  nis2_classification: string | null
  activity_sector: string | null
  nis2_entity_type: string | null
  ir_2024_2690_applicable: boolean
  rationale: string | null
  reviewed_at: string | null
}

export interface BindingGapItem {
  requirement_id: number
  number: string
  section: string
  kind: "finding" | "unanswered"
  basis_label: string | null
  score: number | null
}

export interface BindingGaps {
  round_id: number | null
  round_name?: string
  entities: { entity: EntityRef; assessment_id: number; binding: number; findings: number; unanswered: number; open: number; items: BindingGapItem[] }[]
}

export type DueState = "open" | "due_soon" | "overdue" | "done"

export interface RegistrationChange {
  id: number
  registration_id: number
  entity_id: number
  entity_code: string | null
  jurisdiction: string | null
  field: string
  field_label: string
  old_value: string | null
  new_value: string | null
  known_at: string
  due_at: string
  reported_at: string | null
  reported_reference: string | null
  reported_by: string | null
  note: string | null
  created_by: string | null
  created_at: string
  state: DueState | "reported"
  days_left: number | null
}

export interface RegistrationFields {
  portal: string | null
  status: "not_registered" | "draft" | "submitted" | "confirmed" | "withdrawn"
  registration_number: string | null
  submitted_at: string | null
  registered_at: string | null
  legal_name: string | null
  legal_form: string | null
  register_number: string | null
  address: string | null
  entity_type: string | null
  contact_point: string | null
  contact_point_phone: string | null
  contact_point_email: string | null
  contact_person: string | null
  contact_person_phone: string | null
  contact_person_email: string | null
  public_ip_ranges: string[]
  domain_names: string[]
  sectors: string[]
  member_states: string[]
  authorities: string[]
  scope_rationale: string | null
  reviewed_at: string | null
  notes: string | null
}

export interface Registration extends RegistrationFields {
  id: number
  entity: EntityRef
  jurisdiction: "DE" | "NL"
  updated_at: string
  pending_changes: number
  overdue_changes: number
  next_change_due: string | null
  can_edit: boolean
}

export interface RegistrationDetail extends Registration {
  changes: RegistrationChange[]
  sheet: { field: string; label: string; ref: string; value: string | null }[]
  change_ref: string | null
}

export interface Obligation {
  id: number
  entity: EntityRef | null
  entity_id: number | null
  kind: string
  title: string
  description: string | null
  legal_ref: string | null
  due_date: string
  recurrence: string
  owner_stakeholder_id: number | null
  owner_stakeholder: string | null
  owner_user_id: number | null
  owner_user: string | null
  status: "open" | "done" | "cancelled"
  state: DueState
  completed_at: string | null
  completed_by: string | null
  completion_note: string | null
  source: string
  source_type: string | null
  source_id: number | null
  previous_id: number | null
  can_edit: boolean
  can_complete: boolean
}

export interface MyObligations {
  obligations: Obligation[]
  registration_changes: RegistrationChange[]
  generated_at: string
}

export type TrainingState = "compliant" | "due" | "overdue" | "no_rule"

export interface TrainingStatus {
  status: TrainingState
  last_training: string | null
  last_any_training?: string | null
  deadline: string | null
  trainings: number
}

export interface BoardMember {
  id: number
  entity: EntityRef
  entity_id: number
  name: string
  function: string | null
  user_id: number | null
  user_name: string | null
  email: string | null
  appointed_at: string | null
  left_at: string | null
  notes: string | null
  active: boolean
  training: TrainingStatus
  rule_id: number | null
  can_edit: boolean
}

export interface LinkedRef { type: string; id: number | null; label: string; url?: string | null }

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

export interface BoardDecision {
  id: number
  code: string
  entity: EntityRef
  entity_id: number
  decided_on: string
  decision_type: string
  subject: string
  description: string | null
  participants: string | null
  linked: LinkedRef[]
  created_by: string | null
  created_at: string
  can_edit: boolean
  documents?: DocLinkRow[]
}

export interface TrainingRecord {
  id: number
  person_name: string
  person_role: string | null
  user_id: number | null
  board_member_ids: number[]
  board_members: { id: number; name: string; entity_code: string }[]
  entity_ids: number[]
  entities: EntityRef[]
  title: string
  provider: string | null
  delivery: "internal" | "external"
  training_date: string
  start_time: string | null
  end_time: string | null
  duration_minutes: number | null
  topics: string[]
  legal_refs: string[]
  has_certificate: boolean
  cert_holder_name: string | null
  cert_issued_on: string | null
  cert_dates: string | null
  cert_topics: string | null
  cert_provider: string | null
  cert_language: string | null
  notes: string | null
  can_edit: boolean
  documents?: DocLinkRow[]
}

export interface TrainingRule {
  id: number
  jurisdiction: string
  label: string
  is_statutory: boolean
  legal_ref: string | null
  initial_months: number
  count_from: string | null
  cadence_months: number | null
  requires_certificate: boolean
  note: string | null
}

export interface MatrixEntity {
  entity: EntityRef
  rule: TrainingRule | null
  members: ({ member: { id: number; name: string; function: string | null; appointed_at: string | null }; latest: { id: number; title: string; has_certificate: boolean } | null } & TrainingStatus)[]
}

export interface GovOverview {
  obligations: { open: number; overdue: number; due_soon: number }
  registration_changes: { pending: number; overdue: number; items: RegistrationChange[] }
  training: { members: number; compliant: number; due: number; overdue: number }
  entities: { entity: EntityRef; registrations: { id: number; jurisdiction: string; status: string }[] }[]
}

/* ---------- labels ---------- */

export const LEGAL_STATUS_LABEL: Record<LegalStatus, string> = { binding: "Binding", benchmark: "Benchmark", guidance: "Guidance" }

export const OBLIGATION_KINDS: { value: string; label: string }[] = [
  { value: "policy_review", label: "Policy review" },
  { value: "measures_approval", label: "Measures approval" },
  { value: "oversight_review", label: "Oversight review" },
  { value: "training", label: "Management training" },
  { value: "registration_review", label: "Registration review" },
  { value: "risk_review", label: "Risk review" },
  { value: "bcm_test", label: "Continuity test" },
  { value: "supplier_review", label: "Supplier review" },
  { value: "access_review", label: "Access review" },
  { value: "effectiveness_review", label: "Effectiveness evaluation" },
  { value: "other", label: "Other" },
]
export const KIND_LABEL: Record<string, string> = Object.fromEntries(OBLIGATION_KINDS.map((k) => [k.value, k.label]))

export const RECURRENCE: { value: string; label: string }[] = [
  { value: "none", label: "One-off" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semiannual", label: "Every 6 months" },
  { value: "annual", label: "Annual" },
  { value: "biennial", label: "Every 2 years" },
]
export const RECURRENCE_LABEL: Record<string, string> = Object.fromEntries(RECURRENCE.map((r) => [r.value, r.label]))

export const REG_STATUS: { value: RegistrationFields["status"]; label: string }[] = [
  { value: "not_registered", label: "Not registered" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "confirmed", label: "Confirmed" },
  { value: "withdrawn", label: "Withdrawn" },
]
export const REG_STATUS_LABEL: Record<string, string> = Object.fromEntries(REG_STATUS.map((r) => [r.value, r.label]))

export const DECISION_TYPES: { value: string; label: string }[] = [
  { value: "approve_measures", label: "Approve measures" },
  { value: "approve_policy", label: "Approve policy" },
  { value: "accept_risk", label: "Accept risk" },
  { value: "budget", label: "Budget" },
  { value: "oversight_review", label: "Oversight review" },
  { value: "other", label: "Other" },
]
export const DECISION_LABEL: Record<string, string> = Object.fromEntries(DECISION_TYPES.map((d) => [d.value, d.label]))

export const TRAINING_LABEL: Record<TrainingState, string> = { compliant: "Compliant", due: "Due", overdue: "Overdue", no_rule: "No rule" }
