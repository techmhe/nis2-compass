import { useQuery } from "@tanstack/react-query"
import { Pill } from "@/components/common/basics"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { EntityBrief, StakeholderBrief, UserBrief } from "@/lib/types"
import { cn } from "@/lib/utils"
import type { ApprovalState } from "@/components/approvals/shared"

export type Level = "low" | "medium" | "high" | "very_high"
export type Treatment = "reduce" | "avoid" | "accept" | "transfer"
export type RiskStatus = "identified" | "assessed" | "in_treatment" | "accepted" | "closed"
export type LinkType = "gap" | "control" | "affected" | "treatment"

export interface ScaleStep { label: string; description: string | null }

export interface RiskMethod {
  id: number | null
  entity: EntityBrief | null
  inherited: boolean
  name: string
  likelihood_scale: ScaleStep[]
  impact_scale: ScaleStep[]
  threshold_medium: number
  threshold_high: number
  threshold_very_high: number
  appetite_level: Level
  acceptance_criteria: string | null
  review_cycle_months: number
  matrix: Level[][]
}

export interface Threat { id: number; code: string; title: string; category: string; source: string | null; is_active: boolean }

export interface Risk {
  id: number
  code: string
  entity: EntityBrief | null
  title: string
  scenario: string | null
  threat: Threat | null
  category: string | null
  owner_stakeholder: StakeholderBrief | null
  owner_user: UserBrief | null
  inherent_likelihood: number | null
  inherent_impact: number | null
  inherent_score: number | null
  inherent_level: Level | null
  existing_controls: string | null
  residual_likelihood: number | null
  residual_impact: number | null
  residual_score: number | null
  residual_level: Level | null
  above_appetite: boolean
  appetite_level: Level
  treatments: Treatment[]
  transfer_only: boolean
  treatment_justification: string | null
  acceptance_category: string | null
  status: RiskStatus
  next_review_date: string | null
  last_reviewed_at: string | null
  review_overdue: boolean
  accepted_at: string | null
  accepted_by: string | null
  acceptance_state: ApprovalState
  link_counts: Partial<Record<LinkType, number>>
  created_at: string
  updated_at: string
}

export interface RiskLinkRow {
  id: number
  link_type: LinkType
  target_type: string
  target_id: number
  note: string | null
  created_at: string
  label: string | null
  url: string | null
  status: string | null
  due: string | null
  owner: string | null
  progress: number | null
  info: { due_status?: string | null; entity_code?: string; requirement?: string; section?: string; implemented?: string | null; score?: number | null; gap?: string | null } | null
  exists: boolean
  accessible: boolean
}

export interface RiskDetail {
  risk: Risk
  method: RiskMethod
  links: RiskLinkRow[]
  documents: import("@/lib/types").DocLink[]
  can_edit: boolean
}

export interface RiskMeta {
  treatments: Treatment[]
  statuses: RiskStatus[]
  levels: Level[]
  categories: string[]
  acceptance_categories: string[]
  link_types: LinkType[]
  link_targets: string[]
}

export interface Heatmap {
  method: RiskMethod
  total: number
  cells: { inherent: number[][]; residual: number[][] }
  unrated: { inherent: number; residual: number }
  by_level: { inherent: Record<Level, number>; residual: Record<Level, number> }
  entities: { entity: EntityBrief | null; total: number; residual: Record<Level, number>; above_appetite: number }[]
}

export const LEVELS: Level[] = ["low", "medium", "high", "very_high"]
export const LEVEL_LABEL: Record<Level, string> = { low: "Low", medium: "Medium", high: "High", very_high: "Very high" }
export const TREATMENT_LABEL: Record<Treatment, string> = { reduce: "Reduce", avoid: "Avoid", accept: "Accept", transfer: "Transfer" }
export const TREATMENT_HINT: Record<Treatment, string> = {
  reduce: "Implement measures that lower likelihood or impact",
  avoid: "Stop the activity or remove the asset that causes the risk",
  accept: "Knowingly accept the residual risk (needs an approval)",
  transfer: "Share the risk, e.g. insurance or contract (never as a blanket measure)",
}
export const STATUS_LABEL: Record<RiskStatus, string> = {
  identified: "Identified", assessed: "Assessed", in_treatment: "In treatment", accepted: "Accepted", closed: "Closed",
}
const STATUS_TONE: Record<RiskStatus, string> = {
  identified: "neutral", assessed: "brass", in_treatment: "petrol", accepted: "sage", closed: "outline",
}
export const LINK_TYPE_LABEL: Record<LinkType, string> = {
  gap: "Gaps (assessment answers)",
  control: "Existing controls (assessment answers)",
  affected: "Affected objects",
  treatment: "Treatment measures",
}
export const TARGET_LABEL: Record<string, string> = {
  answer: "Assessment answer", action_item: "Action plan item", work_package: "Work package", document: "Document",
  incident: "Incident", requirement: "Requirement", task: "Task", activity: "Master plan activity", gate: "Gate",
  raid: "RAID record", provision: "Regulation provision", asset: "Asset", service: "Service", supplier: "Supplier",
}
export const targetLabel = (t: string) => TARGET_LABEL[t] ?? t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())

/** Heat map / pill colours per level: colour only where it carries meaning. */
export const LEVEL_CELL: Record<Level, string> = {
  low: "bg-sage-50 text-sage",
  medium: "bg-amber-50 text-amber",
  high: "bg-alarm-50 text-alarm",
  very_high: "bg-alarm text-card",
}

export function LevelPill({ level, score, className }: { level: Level | null | undefined; score?: number | null; className?: string }) {
  if (!level) return <span className={cn("text-[12.5px] text-ink-3", className)}>Not rated</span>
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-[11.5px] leading-none font-medium whitespace-nowrap", LEVEL_CELL[level], className)}>
      {LEVEL_LABEL[level]}{score != null && <span className="tabular opacity-80">{score}</span>}
    </span>
  )
}

export function RiskStatusPill({ status }: { status: RiskStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
}

export function levelOf(m: RiskMethod, l: number | null | undefined, i: number | null | undefined): Level | null {
  if (!l || !i) return null
  return m.matrix[l - 1]?.[i - 1] ?? null
}

export function aboveAppetite(m: RiskMethod, level: Level | null) {
  return level != null && LEVELS.indexOf(level) > LEVELS.indexOf(m.appetite_level)
}

export function useRiskMeta() {
  return useQuery({ queryKey: ["risks", "meta"], queryFn: () => api.get<RiskMeta>("/risks/meta"), staleTime: 30 * 60_000 })
}

export function useThreats(includeInactive = false) {
  return useQuery({
    queryKey: ["risks", "threats", includeInactive],
    queryFn: () => api.get<Threat[]>("/risks/threats", { include_inactive: includeInactive }),
    staleTime: 10 * 60_000,
  })
}

export function useCanManageRisk() {
  const { can, canGlobal } = useAuth()
  return (entityId: number | null | undefined) => (entityId == null ? canGlobal("risks.manage") : can("risks.manage", entityId))
}
