import type { ReactNode } from "react"
import { useQuery, type QueryClient } from "@tanstack/react-query"
import { Pill } from "@/components/common/basics"
import { OptionSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import {
  AUDIT_STATUS_LABEL, EFFECTIVENESS_LABEL, FINDING_STATUS_LABEL, REVIEW_STATUS_LABEL,
  type AuditFinding, type AuditProgramme, type EffectivenessRating,
} from "./types"

export const auditKeys = {
  all: ["audits"] as const,
  programmes: ["audits", "programmes"] as const,
  audits: ["audits", "audits"] as const,
  audit: (id: number) => ["audits", "audit", id] as const,
  findings: ["audits", "findings"] as const,
  reviews: ["audits", "reviews"] as const,
  review: (id: number) => ["audits", "review", id] as const,
  reviewInputs: (id: number) => ["audits", "review-inputs", id] as const,
  mgmtReviews: ["audits", "mgmt-reviews"] as const,
  mgmtReview: (id: number) => ["audits", "mgmt-review", id] as const,
  inputChecklist: ["audits", "input-checklist"] as const,
}

export function invalidateAudits(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: auditKeys.all })
}

export function useProgrammes() {
  const { canAny } = useAuth()
  return useQuery({ queryKey: auditKeys.programmes, queryFn: () => api.get<AuditProgramme[]>("/audits/programmes"), enabled: canAny("audits.read") })
}

export function useAllFindings() {
  const { canAny } = useAuth()
  return useQuery({ queryKey: auditKeys.findings, queryFn: () => api.get<AuditFinding[]>("/audits/findings"), enabled: canAny("audits.read") })
}

/* ---------- filters ---------- */

export function EntityFilter({ value, onChange, className }: { value: number | null; onChange: (v: number | null) => void; className?: string }) {
  const { data = [] } = useEntities()
  const { can } = useAuth()
  const visible = data.filter((e) => e.is_active && can("audits.read", e.id))
  return (
    <OptionSelect className={className} value={value != null ? String(value) : null} onChange={(v) => onChange(v ? Number(v) : null)}
      allowNone noneLabel="All entities" placeholder="All entities"
      options={visible.map((e) => ({ value: String(e.id), label: <span><span className="font-mono text-[12px] text-ink-3">{e.code}</span> {e.name}</span> }))} />
  )
}

/* ---------- pills ---------- */

const AUDIT_STATUS_TONE: Record<string, string> = { planned: "outline", in_progress: "amber", reported: "petrol", closed: "sage" }
export function AuditStatusPill({ status }: { status: string }) {
  return <Pill tone={AUDIT_STATUS_TONE[status] ?? "neutral"}>{AUDIT_STATUS_LABEL[status] ?? status}</Pill>
}

const FINDING_TYPE_TONE: Record<string, string> = { major_nonconformity: "alarm", minor_nonconformity: "amber", observation: "outline", opportunity: "sage" }
export function FindingTypePill({ type }: { type: string }) {
  return <Pill tone={FINDING_TYPE_TONE[type] ?? "neutral"}>{type.replace(/_/g, " ")}</Pill>
}

const FINDING_STATUS_TONE: Record<string, string> = { open: "alarm", action_planned: "amber", closed: "sage" }
export function FindingStatusPill({ status }: { status: string }) {
  return <Pill tone={FINDING_STATUS_TONE[status] ?? "neutral"}>{FINDING_STATUS_LABEL[status] ?? status}</Pill>
}

export function findingDue(f: AuditFinding): "overdue" | "due_soon" | "open" | null {
  if (!f.due_date || f.status === "closed") return null
  const days = Math.round((new Date(f.due_date).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return "overdue"
  if (days <= 14) return "due_soon"
  return "open"
}

const RATING_TONE: Record<string, string> = { effective: "sage", partially_effective: "amber", not_effective: "alarm", not_assessed: "outline" }
export function RatingPill({ rating }: { rating: EffectivenessRating | string }) {
  return <Pill tone={RATING_TONE[rating] ?? "neutral"}>{EFFECTIVENESS_LABEL[rating] ?? rating}</Pill>
}

const REVIEW_STATUS_TONE: Record<string, string> = { draft: "outline", in_review: "amber", approved: "sage" }
export function ReviewStatusPill({ status }: { status: string }) {
  return <Pill tone={REVIEW_STATUS_TONE[status] ?? "neutral"}>{REVIEW_STATUS_LABEL[status] ?? status}</Pill>
}

/** Small label/value line for detail panes (see governance/shared.tsx Meta). */
export function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="text-[13px] break-words text-ink">{children ?? <span className="text-ink-3">–</span>}</div>
    </div>
  )
}

export function GroupPill() {
  return <span className="rounded-[4px] border px-1.5 py-0.5 text-[11.5px] text-ink-3">Group</span>
}
