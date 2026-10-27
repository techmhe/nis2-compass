export type ID = number

export interface UserBrief { id: ID; display_name: string; email: string }
export interface StakeholderBrief { id: ID; name: string; kind: string; user_id: ID | null }
export interface EntityBrief { id: ID; code: string; name: string; country?: string | null }
export interface RequirementBrief { id: ID; number: string; section: string }

export interface Me {
  id: ID
  email: string
  display_name: string
  job_title: string | null
  auth_source: string
  must_change_password: boolean
  permissions: string[]
  global_permissions: string[]
  entity_permissions: Record<string, string[]>
  roles: { key: string; name: string; entity_id: ID | null }[]
  preferences: Record<string, unknown>
  stakeholder_ids: ID[]
}

export interface AuthConfig {
  local_enabled: boolean
  oidc_enabled: boolean
  oidc_display_name: string
  app_name: string
  password_min_length: number
}

export interface Entity {
  id: ID
  code: string
  name: string
  finding_prefix: string
  country: string | null
  is_headquarters: boolean
  legal_form: string | null
  size_class: string | null
  activity_sector: string | null
  nis2_classification: string | null
  competent_authority: string | null
  csirt: string | null
  registration_status: string | null
  registration_date: string | null
  registration_reference: string | null
  employees: number | null
  annual_turnover_meur: number | null
  address: string | null
  contact_name: string | null
  contact_email: string | null
  notes: string | null
  sort_order: number
  is_active: boolean
}

export interface Stakeholder {
  id: ID
  name: string
  kind: string
  user_id: ID | null
  email: string | null
  entity_id: ID | null
  description: string | null
  sort_order: number
  is_active: boolean
}

export interface Chapter {
  id: ID
  number: number
  title: string
  target: number
  source: string
  description: string | null
  requirement_count: number
}

export interface Requirement {
  id: ID
  number: string
  chapter_id: ID
  section: string
  text: string
  check_points: string | null
  legal_reference: string | null
  iso_reference: string | null
  is_core: boolean
  guidance: string | null
  sort_order: number
  is_active: boolean
}

export interface ProvisionLink {
  link_id: ID
  relation: string
  is_auto: boolean
  note: string | null
  provision_id: ID
  regulation_id: ID
  regulation_code: string
  regulation_title: string
  jurisdiction: string
  language: string
  ref: string
  heading: string | null
  text: string | null
}

export interface DocLink {
  link_id: ID
  document_id: ID
  title: string
  doc_type: string
  status: string
  version_label: string | null
  filename: string | null
  note: string | null
}

export interface Round {
  id: ID
  name: string
  description: string | null
  start_date: string | null
  end_date: string | null
  status: string
  is_current: boolean
  targets_snapshot: Record<string, number> | null
}

export interface AssessmentStats {
  total: number
  in_scope: number
  central_at_hq: number
  not_applicable: number
  assessed: number
  coverage: number | null
  average_score: number | null
  work_packages: number
  no_answers: number
  not_tested: number
  answer_distribution: Record<string, number>
  reviewed: number
  core_total: number
  core_assessed: number
}

export interface AssessmentListItem {
  id: ID
  round_id: ID
  entity_id: ID
  status: string
  assessment_date: string | null
  due_date: string | null
  respondents: string | null
  assessors: string | null
  lead_user_id: ID | null
  summary: string | null
  locked: boolean
  completed_at: string | null
  entity: EntityBrief
  round_name: string
  stats: AssessmentStats
}

export interface AssessmentDetail extends Omit<AssessmentListItem, "round_name"> {
  entity: EntityBrief & { finding_prefix: string }
  round: Round
  lead: UserBrief | null
  chapters: Record<string, { average: number | null; work_packages: number; assessed: number; in_scope: number }>
  can_edit: boolean
  can_manage: boolean
}

export interface AnswerRow {
  id: ID
  requirement_id: ID
  number: string
  chapter: number
  section: string
  text: string
  is_core: boolean
  scope: string
  implemented: string | null
  documented: string | null
  effectiveness: string | null
  evidence: string | null
  gap_description: string | null
  recommended_action: string | null
  responsible: StakeholderBrief | null
  target_date: string | null
  effort: string | null
  notes: string | null
  review_status: string
  score: number | null
  wp_required: boolean | null
  finding_id: string | null
  updated_at: string
  doc_count: number
  comment_count: number
}

export interface AnswerDetail {
  answer: AnswerRow
  requirement: {
    id: ID
    number: string
    section: string
    text: string
    check_points: string | null
    legal_reference: string | null
    iso_reference: string | null
    guidance: string | null
    is_core: boolean
    chapter: { number: number; title: string }
  }
  entity: EntityBrief
  other_entities: ({ answer_id: ID; assessment_id: ID; entity_code: string; entity_name: string } & Partial<AnswerRow>)[]
  history: { answer_id: ID; round: string; score: number | null; implemented: string | null; documented: string | null; effectiveness: string | null }[]
  revisions: { id: ID; changed_at: string; changes: Record<string, [unknown, unknown]>; by: string | null }[]
  documents: DocLink[]
  tasks: { id: ID; key: string; title: string; status: string; assignee: string | null; due_date: string | null }[]
  can_edit: boolean
}

export interface ActionItem {
  id: ID
  code: string
  round_id: ID | null
  entity: EntityBrief
  requirement: RequirementBrief
  chapter: string
  requirement_text: string
  identified_gap: string | null
  finding_id: string | null
  title: string
  priority: string
  acceptance_criterion: string | null
  expected_evidence: string | null
  responsible: StakeholderBrief | null
  assessment_owner: string | null
  target_date: string | null
  status: string
  due_status: string | null
  comments: string | null
  work_packages: { id: ID; code: string; title: string }[]
  updated_at: string
}

export interface UnplannedFinding {
  answer_id: ID
  assessment_id: ID
  finding_id: string | null
  entity: EntityBrief
  requirement: RequirementBrief
  chapter: number
  score: number | null
  gap_description: string | null
  recommended_action: string | null
  target_date: string | null
  effort: string | null
  responsible: string | null
  responsible_id: ID | null
}

export interface Project {
  id: ID
  name: string
  code: string
  status: string
  planned_start: string | null
  planned_finish: string | null
  sponsor: string | null
  manager: UserBrief | null
  description: string | null
  overview: { field: string; value: string | null }[]
  version_note: string | null
}

export interface Phase { id: ID; name: string; sort_order: number }

export interface Gate {
  id: ID
  project_id: ID
  code: string
  planned_date: string | null
  actual_date: string | null
  decision: string | null
  decision_owner: StakeholderBrief | null
  required_input: string | null
  approval_criterion: string | null
  status: string
  decision_reference: string | null
  sort_order: number
  activities: number
  open_activities: number
}

export interface Activity {
  id: ID
  project_id: ID
  code: string
  phase: Phase | null
  title: string
  owner: StakeholderBrief | null
  support: string | null
  planned_start: string | null
  planned_finish: string | null
  actual_finish: string | null
  duration_weeks: number | null
  dependencies: { id: ID; code: string }[]
  deliverable: string | null
  gate: { id: ID; code: string; planned_date: string | null } | null
  status: string
  priority: string
  progress: number
  schedule_status: string
  sort_order: number
  is_milestone: boolean
  task_count: number
  updated_at: string
}

export interface RaidRecord {
  id: ID
  project_id: ID
  code: string
  type: string
  date_raised: string | null
  title: string
  impact: string | null
  probability: string | null
  severity: string | null
  owner: StakeholderBrief | null
  mitigation: string | null
  target_date: string | null
  status: string
  escalation_needed: boolean
  resolution: string | null
  entity_id: ID | null
  due_status: string | null
  updated_at: string
}

export interface WorkPackage {
  id: ID
  project_id: ID
  code: string
  title: string
  description: string | null
  entity: EntityBrief | null
  measure_area: string | null
  central_or_local: string
  priority: string
  owner: UserBrief | null
  owner_stakeholder: StakeholderBrief | null
  planned_start: string | null
  planned_finish: string | null
  acceptance_criterion: string | null
  expected_evidence: string | null
  dependency: string | null
  status: string
  progress: number
  progress_mode: string
  budget_eur: number | null
  comments: string | null
  activity_id: ID | null
  schedule_status: string
  findings: { id: ID; code: string; entity_code: string; requirement: string; title: string; status: string }[]
  task_stats: { total: number; done: number; by_status?: Record<string, number> }
  updated_at: string
}

export interface Task {
  id: ID
  key: string
  title: string
  description: string | null
  status: TaskStatus
  priority: string
  assignee: UserBrief | null
  reporter: UserBrief | null
  start_date: string | null
  due_date: string | null
  estimate_hours: number | null
  labels: string[]
  checklist: { text: string; done: boolean }[]
  sort_order: number
  completed_at: string | null
  project_id: ID | null
  work_package: { id: ID; code: string; title: string } | null
  activity_id: ID | null
  action_item_id: ID | null
  answer_id: ID | null
  entity: EntityBrief | null
  created_at: string
  updated_at: string
  overdue: boolean
}
export type TaskStatus = "todo" | "in_progress" | "review" | "done" | "blocked"

export interface DocVersion {
  id: ID
  version_no: number
  filename: string
  mime_type: string
  size: number
  sha256: string
  extraction_status: string
  page_count: number | null
  change_note: string | null
  uploaded_by: UserBrief | null
  uploaded_at: string
}

export interface DocumentItem {
  id: ID
  title: string
  description: string | null
  doc_type: string
  status: string
  classification: string
  entity: EntityBrief | null
  folder_id: ID | null
  owner: UserBrief | null
  tags: string[]
  version_label: string | null
  approved_at: string | null
  approved_by: string | null
  next_review_date: string | null
  external_url: string | null
  current_version: DocVersion | null
  created_at: string
  updated_at: string
  review_overdue: boolean
  link_count: number
  snippet: string | null
}

export interface Regulation {
  id: ID
  code: string
  title: string
  short_title: string
  kind: string
  jurisdiction: string
  language: string
  version_date: string | null
  source_url: string | null
  status_note: string | null
  license_note: string | null
  is_builtin: boolean
  provision_count: number
  linked_requirements: number
}

export interface ProvisionNode {
  id: ID
  parent_id: ID | null
  key: string
  ref: string
  heading: string | null
  text: string | null
  depth: number
  links: number
}

export interface SearchHit {
  source_type: string
  source_label: string
  source_id: ID
  title: string
  snippet: string
  url: string | null
  entity_id: ID | null
  score: number
  meta: Record<string, unknown> | null
}

export interface Incident {
  id: ID
  code: string
  entity: EntityBrief | null
  title: string
  description: string | null
  category: string | null
  severity: string
  status: string
  is_significant: boolean | null
  significance_rationale: string | null
  detected_at: string | null
  aware_at: string | null
  early_warning_at: string | null
  notification_at: string | null
  intermediate_report_at: string | null
  final_report_at: string | null
  authority: string | null
  authority_reference: string | null
  suspected_malicious: boolean | null
  cross_border_impact: boolean | null
  impact: string | null
  indicators_of_compromise: string | null
  root_cause: string | null
  measures: string | null
  lessons_learned: string | null
  handler_id: ID | null
  handler_name: string | null
  timeline: { at: string; text: string; by: string }[]
  reporting: { key: string; label: string; due: string; done_at: string | null; state: string; hours_left: number | null }[]
  created_at: string
  updated_at: string
}

export interface Comment {
  id: ID
  target_type: string
  target_id: ID
  body: string
  created_at: string
  edited_at: string | null
  author: UserBrief | null
}

export interface NotificationItem {
  id: ID
  kind: string
  title: string
  body: string | null
  link: string | null
  is_read: boolean
  created_at: string
}

export interface Role {
  id: ID
  key: string
  name: string
  description: string | null
  permissions: string[]
  is_system: boolean
}

export interface AdminUser {
  id: ID
  email: string
  display_name: string
  job_title: string | null
  auth_source: string
  is_active: boolean
  must_change_password: boolean
  last_login_at: string | null
  created_at: string
  assignments: { id: ID; role_id: ID; entity_id: ID | null }[]
}

export interface ChatSource { n: number; type: string; id: ID; title: string; url: string | null; snippet: string }
export interface ChatMessage {
  id?: ID
  role: "user" | "assistant"
  content: string
  sources?: ChatSource[]
  tool_trace?: { tool: string; args: Record<string, unknown> }[]
  feedback?: number | null
  created_at?: string
  pending?: boolean
}
