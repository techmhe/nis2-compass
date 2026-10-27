import { useQuery } from "@tanstack/react-query"
import { Pill } from "@/components/common/basics"
import { Combo } from "@/components/common/fields"
import { api } from "@/lib/api"
import type { DocumentItem, EntityBrief } from "@/lib/types"

export type Tier = "critical" | "high" | "standard"
export type ClauseStatus = "agreed" | "partial" | "missing" | "na"
export type DueState = "overdue" | "due_soon" | "ok" | "never" | "n/a"

export interface Contact { name: string | null; role: string | null; email: string | null; phone: string | null }

export interface SupplierSummary {
  id: number
  code: string
  name: string
  legal_name: string | null
  country: string | null
  category: string | null
  access_type: string
  tier: Tier
  suggested_tier: Tier
  tier_reason: string
  tier_overridden: boolean
  status: string
  services_products: string | null
  entities: EntityBrief[]
  relationship_owner: { id: number; name: string } | null
  clauses: Record<string, ClauseStatus>
  clause_counts: Record<ClauseStatus, number>
  certificates: { total: number; valid: number; expiring: number; expired: number; types: string[] }
  last_assessment: { id: number; assessed_on: string; method: string; score: number | null; rating: string | null } | null
  next_due: string | null
  due_state: DueState
  dependent_services: number
  dependent_assets: number
  max_service_criticality: number | null
  updated_at: string
  can_edit: boolean
}

export interface DocBrief { id: number; title: string; status: string }

export interface Certificate {
  id: number
  cert_type: string
  scope: string | null
  issuer: string | null
  valid_until: string | null
  state: "valid" | "expiring" | "expired" | "unknown"
  document: DocBrief | null
  notes: string | null
}

export interface ClauseRow {
  clause: string
  title: string
  text: string
  id: number | null
  status: ClauseStatus
  reference: string | null
  note: string | null
  document: DocBrief | null
  updated_at: string | null
}

export interface Finding {
  text: string
  severity: "high" | "medium" | "low"
  action_item_id: number | null
  action_item_code?: string | null
  question_id?: string | null
}

export interface Assessment {
  id: number
  assessed_on: string
  method: string
  score: number | null
  rating: string | null
  summary: string | null
  findings: Finding[]
  answers: { id: string; question: string; answer: string | null; comment: string | null }[]
  template_id: number | null
  template_version: number | null
  next_due: string | null
  assessor: string | null
  created_at: string
}

export interface DepService { id: number; code: string; name: string; entity_id: number | null; criticality: number; status: string; via: string; entity: EntityBrief | null }
export interface DepAsset { id: number; code: string; name: string; entity_id: number | null; asset_type: string; criticality: number | null; lifecycle: string; entity: EntityBrief | null }

export interface SupplierDetail extends SupplierSummary {
  website: string | null
  description: string | null
  tier_rationale: string | null
  contacts: Contact[]
  relationship_owner_id: number | null
  contract_reference: string | null
  contract_end: string | null
  notes: string | null
  entity_ids: number[]
  created_at: string
  certificate_list: Certificate[]
  clause_list: ClauseRow[]
  provision: { regulation_id: number; provision_id: number; url: string } | null
  assessments: Assessment[]
  services: DepService[]
  assets: DepAsset[]
  hidden_dependencies: number
  documents: import("@/lib/types").DocLink[]
  review_months: Record<Tier, number>
}

export interface SupplierMeta {
  access_types: Record<string, string>
  tiers: Record<Tier, string>
  statuses: Record<string, string>
  methods: Record<string, string>
  ratings: Record<string, string>
  clause_statuses: Record<ClauseStatus, string>
  cert_types: string[]
  clauses: { clause: string; title: string; text: string }[]
  review_months: Record<Tier, number>
  provision: { regulation_id: number; provision_id: number; url: string } | null
}

export interface Question { id: string | null; section: string | null; text: string; reference: string | null; weight: number }
export interface Template {
  id: number
  tier: Tier
  version: number
  title: string
  questions: Question[]
  change_note: string | null
  created_at: string
  created_by: string | null
}

export const TIER_ORDER: Tier[] = ["critical", "high", "standard"]
export const CLAUSE_CODES = ["a", "b", "c", "d", "e", "f", "g", "h"]

export const FALLBACK_META: SupplierMeta = {
  access_types: { none: "No access", it_remote: "IT remote access", ot_remote: "OT remote maintenance", cloud_data: "Cloud / data processing" },
  tiers: { critical: "Critical", high: "High", standard: "Standard" },
  statuses: { active: "Active", onboarding: "Onboarding", offboarded: "Offboarded" },
  methods: { questionnaire: "Questionnaire", certificate_review: "Certificate review", audit: "Audit", on_site: "On-site visit" },
  ratings: { acceptable: "Acceptable", conditional: "Acceptable with conditions", not_acceptable: "Not acceptable" },
  clause_statuses: { agreed: "Agreed", partial: "Partial", missing: "Missing", na: "Not applicable" },
  cert_types: ["ISO/IEC 27001", "TISAX", "SOC 2 Type II", "IEC 62443", "BSI C5", "Other"],
  clauses: [],
  review_months: { critical: 12, high: 24, standard: 36 },
  provision: null,
}

export function useSupplierMeta() {
  const q = useQuery({ queryKey: ["suppliers", "meta"], queryFn: () => api.get<SupplierMeta>("/suppliers/meta"), staleTime: 30 * 60_000 })
  return q.data ?? FALLBACK_META
}

export const supplierKey = (id: number) => ["suppliers", "detail", id] as const

export function TierPill({ tier, title }: { tier: Tier | null | undefined; title?: string }) {
  if (!tier) return <span className="text-ink-3">–</span>
  const tone = tier === "critical" ? "alarm" : tier === "high" ? "amber" : "neutral"
  return <Pill tone={tone} title={title}>{FALLBACK_META.tiers[tier]}</Pill>
}

export function SupplierStatusPill({ status }: { status: string }) {
  const tone = status === "active" ? "petrol" : status === "onboarding" ? "brass" : "outline"
  return <Pill tone={tone}>{FALLBACK_META.statuses[status] ?? status}</Pill>
}

export function ClausePill({ status }: { status: ClauseStatus }) {
  const tone = status === "agreed" ? "petrol" : status === "partial" ? "amber" : status === "missing" ? "alarm" : "neutral"
  return <Pill tone={tone}>{FALLBACK_META.clause_statuses[status]}</Pill>
}

export const CLAUSE_CELL: Record<ClauseStatus, string> = {
  agreed: "bg-petrol text-white",
  partial: "bg-amber-50 text-amber border border-amber/40",
  missing: "bg-alarm-50 text-alarm border border-alarm/40",
  na: "bg-muted text-ink-3",
}
export const CLAUSE_SHORT: Record<ClauseStatus, string> = { agreed: "Yes", partial: "Part", missing: "No", na: "n.a." }

export function CertStatePill({ state }: { state: Certificate["state"] }) {
  const map = { valid: ["sage", "Valid"], expiring: ["amber", "Expiring soon"], expired: ["alarm", "Expired"], unknown: ["outline", "No expiry date"] } as const
  const [tone, label] = map[state]
  return <Pill tone={tone}>{label}</Pill>
}

export function RatingPill({ rating }: { rating: string | null }) {
  if (!rating) return <span className="text-ink-3">–</span>
  const tone = rating === "acceptable" ? "sage" : rating === "conditional" ? "amber" : "alarm"
  return <Pill tone={tone}>{FALLBACK_META.ratings[rating] ?? rating}</Pill>
}

export function SeverityPill({ severity }: { severity: string }) {
  const tone = severity === "high" ? "alarm" : severity === "medium" ? "amber" : "neutral"
  return <Pill tone={tone}>{severity === "high" ? "High" : severity === "medium" ? "Medium" : "Low"}</Pill>
}

export function dueTone(state: DueState): string {
  return state === "overdue" ? "text-alarm" : state === "due_soon" ? "text-amber" : state === "never" ? "text-alarm" : "text-ink-2"
}

export function dueLabel(state: DueState): string {
  return { overdue: "Overdue", due_soon: "Due soon", ok: "On track", never: "Never assessed", "n/a": "Not required" }[state]
}

export const CRITICALITY_LABEL: Record<number, string> = { 1: "Low", 2: "Medium", 3: "High", 4: "Critical" }

export function CriticalityPill({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-ink-3">–</span>
  const tone = value >= 4 ? "alarm" : value === 3 ? "amber" : "neutral"
  return <Pill tone={tone}>{CRITICALITY_LABEL[value] ?? value}</Pill>
}

/** Pick an existing document (for contract and certificate evidence). */
export function DocumentPicker({ value, onChange, disabled }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  const q = useQuery({ queryKey: ["suppliers", "document-options"], queryFn: () => api.get<DocumentItem[]>("/documents"), staleTime: 60_000 })
  return (
    <Combo value={value} onChange={onChange} disabled={disabled} placeholder="No document linked" searchPlaceholder="Search documents…"
      items={(q.data ?? []).map((d) => ({ value: d.id, label: d.title, hint: d.doc_type }))} />
  )
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
