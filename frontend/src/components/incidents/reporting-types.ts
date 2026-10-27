import type { Incident } from "@/lib/types"

export type Answer = "yes" | "no" | "unknown"
export type Result = "significant" | "not_significant" | "undetermined"
export type Regime = "nis2" | "gdpr" | "cra"
export type StageState = "submitted" | "overdue" | "due_soon" | "pending" | "waiting" | "not_required"

export interface Citation { code: string | null; key: string | null; label: string; url: string | null }

export interface Criterion {
  key: string
  kind: "criterion" | "exclusion"
  label: string
  detail: string
  ref: Citation
  uses_threshold?: boolean
  uses_recurring?: boolean
}
export interface CriteriaGroup { key: string; title: string; intro: string | null; source: Citation | null; profiles: string[]; criteria: Criterion[] }
export interface CriteriaCatalogue {
  criteria: Record<string, CriteriaGroup[]>
  sector_profiles: Record<string, { key: string; label: string }[]>
  profile_notes: Record<string, string>
  stage_labels: Record<string, string>
  root_cause_categories: Record<string, string>
}

export interface EntityRef { id: number; code: string; name: string; country: string | null }

export interface Assessment {
  id: number
  entity: EntityRef
  jurisdiction: "DE" | "NL"
  sector_profile: string
  answers: Record<string, Answer>
  suggested_result: Result
  result: Result
  rationale: string | null
  met_criteria: { key: string; label: string }[]
  decided_by: string | null
  decided_at: string
}

export interface Stage {
  stage: string
  label: string
  window: string
  ref: Citation
  due_at: string | null
  submitted_at: string | null
  reference: string | null
  note: string | null
  requested_at: string | null
  state: StageState
  hours_left: number | null
  checklist: { key: string; label: string; done: boolean }[]
  info: string | null
}

export interface Track {
  id: number
  incident_id: number
  regime: Regime
  jurisdiction: "DE" | "NL" | null
  entity: EntityRef
  authority: string
  reference: string | null
  aware_at: string | null
  effective_aware_at: string | null
  status: "active" | "withdrawn"
  notes: string | null
  stages: Stage[]
  next: { stage: string; label: string; due_at: string; state: StageState } | null
  complete: boolean
}

export interface NextDeadline {
  stage: string
  label: string
  due_at: string
  state: StageState
  track_id: number
  entity_code: string
  authority: string
  regime: Regime
}

export interface Recurring {
  category: string
  category_label: string
  count: number
  window_days: number
  combined_loss_eur: number
  threshold_eur: number
  turnover_known: boolean
  meets_financial_criterion: boolean
  incidents: { id: number; code: string; title: string; at: string; is_significant: boolean | null; financial_loss_eur: number | null }[]
}

export interface Affected {
  entity: EntityRef
  jurisdiction: "DE" | "NL" | null
  sector_profiles: { key: string; label: string }[]
  default_profile: string
  sector: string | null
  threshold_eur: number
  turnover_known: boolean
  latest_assessment: Assessment | null
  can_edit: boolean
}

export interface ReportingOverview {
  incident_id: number
  can_edit: boolean
  profile: {
    affected_entity_ids: number[]
    root_cause_category: string | null
    financial_loss_eur: number | null
    personal_data_breach: boolean | null
    product_affected: boolean | null
    handled_at: string | null
    supplier_ids: number[]
  }
  suppliers: { id: number; name: string }[]
  follow_up_tasks: { id: number; key: string; title: string; status: string; due_date: string | null; assignee: string | null }[]
  affected: Affected[]
  assessments: Assessment[]
  tracks: Track[]
  next_deadline: NextDeadline | null
  recurring: Recurring | null
  root_cause_categories: Record<string, string>
}

export interface RecurringGroup {
  entity: { id: number; code: string; name: string }
  category: string
  category_label: string
  count: number
  combined_loss_eur: number
  threshold_eur: number
  meets_financial_criterion: boolean
  incidents: { id: number; code: string; title: string; at: string }[]
}

/** Incident list/detail payload including the report-track fields added by the incident reporting module. */
export type IncidentX = Incident & { track_count?: number; next_deadline?: NextDeadline | null }

export const REGIME_LABEL: Record<Regime, string> = { nis2: "NIS-2", gdpr: "GDPR", cra: "CRA" }
export const RESULT_LABEL: Record<Result, string> = { significant: "Significant", not_significant: "Not significant", undetermined: "Undetermined" }

export function eur(v: number | null | undefined): string {
  if (v == null) return "–"
  return `€${Math.round(v).toLocaleString("en-GB")}`
}

/** Mirror of the server-side rule (features/incident_reporting/criteria.py: evaluate). */
export function evaluate(groups: CriteriaGroup[], answers: Record<string, Answer>): Result {
  const all = groups.flatMap((g) => g.criteria)
  if (all.some((c) => c.kind === "exclusion" && answers[c.key] === "yes")) return "not_significant"
  const crit = all.filter((c) => c.kind === "criterion")
  if (crit.some((c) => answers[c.key] === "yes")) return "significant"
  if (crit.every((c) => answers[c.key] === "no")) return "not_significant"
  return "undetermined"
}
