import type { DocLink } from "@/lib/types"
import type { EntityRef } from "@/components/controls/types"

export type Severity = "critical" | "high" | "medium" | "low"
export type AdvisorySource = "CERT-Bund" | "NCSC-NL" | "BSI" | "vendor_psirt" | "supplier" | "other"
export type AdvisoryStatus = "new" | "in_assessment" | "assessed" | "closed"
export type Relevant = "yes" | "no" | "unclear"
export type YesNo = "yes" | "no"
export type VulnStatus = "open" | "in_progress" | "mitigated" | "remediated" | "accepted"

export interface AssetRef { id: number; code: string; name: string }
export interface SupplierRef { id: number; code: string; name: string }

export interface Advisory {
  id: number
  code: string
  title: string
  source: AdvisorySource
  reference: string | null
  received_on: string
  severity: Severity
  summary: string | null
  entity_scope: "all" | "list"
  entity_ids: number[]
  entities: EntityRef[]
  created_by_id: number | null
  created_by_name: string | null
  asset_ids: number[]
  assets: AssetRef[]
  supplier_ids: number[]
  suppliers: SupplierRef[]
  relevant: Relevant | null
  measures_need_adjustment: YesNo | null
  rationale: string | null
  assessed_by_id: number | null
  assessed_by_name: string | null
  assessed_on: string | null
  assessment_due: string
  status: AdvisoryStatus
  overdue: boolean
  vulnerability_ids: number[]
  task_ids: number[]
  can_edit: boolean
  created_at: string
  updated_at: string
  documents?: DocLink[]
}

export interface Vulnerability {
  id: number
  code: string
  title: string
  cve_ids: string[]
  advisory_id: number | null
  advisory: { id: number; code: string; title: string } | null
  entity: EntityRef | null
  entity_id: number | null
  severity: Severity
  cvss: number | null
  discovered_on: string
  remediation_due: string
  owner_user_id: number | null
  owner_user_name: string | null
  owner_stakeholder_id: number | null
  owner_stakeholder_name: string | null
  status: VulnStatus
  remediated_on: string | null
  exception_id: number | null
  exception: { id: number; code: string; title: string } | null
  acceptance_justification: string | null
  notes: string | null
  asset_ids: number[]
  assets: AssetRef[]
  task_ids: number[]
  overdue: boolean
  can_edit: boolean
  created_at: string
  updated_at: string
  documents?: DocLink[]
}
