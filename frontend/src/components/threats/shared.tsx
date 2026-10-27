import { Pill } from "@/components/common/basics"
import type { AdvisorySource, AdvisoryStatus, Severity, VulnStatus } from "./types"

export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" }

export function SeverityPill({ severity }: { severity: Severity }) {
  const tone = severity === "critical" ? "alarm" : severity === "high" ? "amber" : severity === "medium" ? "brass" : "outline"
  return <Pill tone={tone}>{SEVERITY_LABEL[severity]}</Pill>
}

export const SOURCE_LABEL: Record<AdvisorySource, string> = {
  "CERT-Bund": "CERT-Bund", "NCSC-NL": "NCSC-NL", BSI: "BSI", vendor_psirt: "Vendor PSIRT", supplier: "Supplier",
  other: "Other",
}

export const ADVISORY_STATUS_LABEL: Record<AdvisoryStatus, string> = {
  new: "New", in_assessment: "In assessment", assessed: "Assessed", closed: "Closed",
}

export function AdvisoryStatusPill({ status, overdue }: { status: AdvisoryStatus; overdue?: boolean }) {
  if (overdue && status !== "closed") return <Pill tone="alarm">Assessment overdue</Pill>
  const tone = status === "closed" ? "petrol" : status === "assessed" ? "petrol" : status === "in_assessment" ? "brass" : "outline"
  return <Pill tone={tone}>{ADVISORY_STATUS_LABEL[status]}</Pill>
}

export const VULN_STATUS_LABEL: Record<VulnStatus, string> = {
  open: "Open", in_progress: "In progress", mitigated: "Mitigated", remediated: "Remediated", accepted: "Accepted",
}

export function VulnStatusPill({ status, overdue }: { status: VulnStatus; overdue?: boolean }) {
  if (overdue && (status === "open" || status === "in_progress")) return <Pill tone="alarm">Remediation overdue</Pill>
  const tone = status === "remediated" ? "petrol" : status === "mitigated" ? "brass" : status === "accepted" ? "outline"
    : status === "in_progress" ? "amber" : "neutral"
  return <Pill tone={tone}>{VULN_STATUS_LABEL[status]}</Pill>
}
