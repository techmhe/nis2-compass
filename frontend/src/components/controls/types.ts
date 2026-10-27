import type { DocLink } from "@/lib/types"

export interface EntityRef { id: number; code: string; name: string; country?: string | null }

export type Recurrence = "monthly" | "quarterly" | "semi_annual" | "annual" | "custom"
export type OccStatus = "planned" | "overdue" | "done" | "skipped"
export type OccResult = "effective" | "partially_effective" | "not_effective"
export type Freshness = "fresh" | "ageing" | "stale" | "none"

export interface ActivityStats {
  done?: number
  overdue?: number
  not_effective?: number
  partially_effective?: number
  planned?: number
  next_due?: string | null
  last_done?: string | null
}

export interface ControlActivity {
  id: number
  code: string
  title: string
  description: string | null
  requirement_ids: number[]
  requirements: { id: number; number: string; section: string }[]
  legal_refs: string | null
  entity_scope: "all" | "list"
  entity_ids: number[]
  entities: EntityRef[]
  recurrence: Recurrence
  rrule: string | null
  anchor_month: number
  owner_stakeholder_id: number | null
  owner_stakeholder_name: string | null
  owner_user_id: number | null
  owner_user_name: string | null
  required_evidence: string | null
  evidence_validity_days: number
  active: boolean
  created_at: string
  updated_at: string
  stats: ActivityStats
}

export interface Occurrence {
  id: number
  activity: { id: number; code: string; title: string; required_evidence: string | null }
  entity: EntityRef
  period_key: string
  period_label: string
  due_date: string
  status: OccStatus
  stored_status: "planned" | "done" | "skipped"
  performed_by_id: number | null
  performed_by_name: string | null
  performed_at: string | null
  result: OccResult | null
  notes: string | null
  action_item_id: number | null
  has_evidence: boolean | null
  updated_at: string
  can_record?: boolean
}

export interface OccurrenceDetail {
  occurrence: Occurrence
  activity: ControlActivity
  documents: DocLink[]
  action_item: { id: number; code: string; title: string; status: string } | null
  can_record: boolean
  can_create_finding: boolean
}

export interface CalendarCell { id: number; entity_code: string; entity_id: number; status: OccStatus; result: OccResult | null; due_date: string; period_label: string }
export interface CalendarData {
  months: string[]
  today: string
  rows: { activity: { id: number; code: string; title: string; recurrence: Recurrence; active: boolean }; cells: Record<string, CalendarCell[]> }[]
}

export interface FreshnessItem {
  answer_id: number
  requirement_id: number
  last_evidence_at: string | null
  source: "document" | "control" | null
  source_label: string | null
  age_days: number | null
  validity_days: number
  status: Freshness
  activities: { id: number; code: string }[]
}

export interface EvidenceRow extends FreshnessItem {
  assessment_id: number
  entity: EntityRef
  requirement: { id: number; number: string; section: string; chapter: number }
  implemented: string | null
  effectiveness: string | null
}

export interface EvidenceData {
  round_id: number | null
  as_of?: string
  items: EvidenceRow[]
  summary: ({ entity: EntityRef } & Record<Freshness, number>)[]
}

export type ExceptionStatus = "requested" | "approved" | "rejected" | "revoked" | "expired"
export interface ControlException {
  id: number
  code: string
  title: string
  scope_type: "entity" | "requirement" | "control"
  entity: EntityRef | null
  requirement: { id: number; number: string; section: string } | null
  activity: { id: number; code: string; title: string } | null
  reason: string
  compensating_measures: string | null
  requested_by_id: number | null
  requested_by_name: string | null
  approver_id: number | null
  approver_name: string | null
  status: ExceptionStatus
  decided_at: string | null
  decision_note: string | null
  expires_at: string
  days_to_expiry: number
  created_at: string
  updated_at: string
  can_edit: boolean
  can_decide: boolean
}

// --- KPIs ---------------------------------------------------------------------------------------------------

export type KpiUnit = "%" | "count" | "days" | "hours" | "EUR"
export type KpiFrequency = "monthly" | "quarterly" | "annual"
export type KpiStatus = "met" | "missed" | "no_data" | "no_target"

export interface KpiDefinition {
  id: number
  code: string
  name: string
  unit: KpiUnit
  direction: "higher" | "lower"
  description: string | null
  legal_refs: string | null
  default_target: number | null
  frequency: KpiFrequency
  computation: string | null
  computation_label: string | null
  active: boolean
  sort_order: number
  instances: number | null
}

export interface KpiValue {
  period: string
  label: string
  period_end: string
  value: number
  source: "manual" | "computed" | "import"
  note: string | null
  recorded_by: string | null
  updated_at: string
}

export interface KpiInstance {
  id: number
  definition_id: number
  entity: EntityRef | null
  target: number | null
  effective_target: number | null
  owner_user_id: number | null
  owner_name: string | null
  latest: KpiValue | null
  previous: KpiValue | null
  status: KpiStatus
  stale: boolean
  trend: { period: string; label: string; value: number }[]
  can_edit: boolean
  can_enter: boolean
}

export interface KpiOverview { items: (KpiDefinition & { instance_rows: KpiInstance[] })[]; can_manage: boolean }
export interface KpiInstanceDetail { definition: KpiDefinition; instance: KpiInstance; values: KpiValue[]; open_periods: string[] }
export interface KpiGrid {
  entity_id: number | null
  rows: { instance: KpiInstance; definition: KpiDefinition; periods: { period: string; label: string; value: KpiValue | null }[] }[]
}
