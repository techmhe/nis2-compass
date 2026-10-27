import type { ReactNode } from "react"
import { Pill } from "@/components/common/basics"
import { cn } from "@/lib/utils"
import type { ExceptionStatus, Freshness, KpiStatus, KpiUnit, OccResult, OccStatus, Recurrence } from "./types"

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  monthly: "Monthly", quarterly: "Quarterly", semi_annual: "Semi-annual", annual: "Annual", custom: "Custom schedule",
}

/** "Quarterly, due in the 3rd month" style description of an activity's schedule. */
export function scheduleText(rec: Recurrence, anchor: number, rrule?: string | null): string {
  if (rec === "custom") return rrule ? `Custom: ${rrule}` : "Custom schedule"
  if (rec === "monthly") return "Monthly, due at month end"
  if (rec === "annual") return `Annual, due end of ${MONTHS[anchor - 1]}`
  const nth = ["1st", "2nd", "3rd", "4th", "5th", "6th"][anchor - 1]
  return `${RECURRENCE_LABEL[rec]}, due end of the ${nth} month`
}

export const RESULT_LABEL: Record<OccResult, string> = {
  effective: "Effective", partially_effective: "Partially effective", not_effective: "Not effective",
}

export const STATUS_LABEL: Record<OccStatus, string> = { planned: "Planned", overdue: "Overdue", done: "Done", skipped: "Skipped" }

export function OccurrencePill({ status, result }: { status: OccStatus; result?: OccResult | null }) {
  if (status === "done" && result) {
    const tone = result === "effective" ? "petrol" : result === "partially_effective" ? "amber" : "alarm"
    return <Pill tone={tone}>{RESULT_LABEL[result]}</Pill>
  }
  const tone = status === "overdue" ? "alarm" : status === "skipped" ? "outline" : status === "done" ? "petrol" : "neutral"
  return <Pill tone={tone}>{STATUS_LABEL[status]}</Pill>
}

/** Background colour of a calendar cell: result for done items, alarm for overdue. */
export function cellTone(status: OccStatus, result?: OccResult | null): string {
  if (status === "done") {
    if (result === "not_effective") return "bg-alarm text-white"
    if (result === "partially_effective") return "bg-amber text-white"
    return "bg-petrol text-white"
  }
  if (status === "overdue") return "border border-alarm bg-alarm-50 text-alarm"
  if (status === "skipped") return "border border-dashed border-ink-3/50 text-ink-3"
  return "border bg-surface text-ink-2"
}

export const FRESHNESS_LABEL: Record<Freshness, string> = { fresh: "Fresh", ageing: "Ageing", stale: "Stale", none: "No evidence" }

export function FreshnessPill({ status, title }: { status: Freshness; title?: string }) {
  const tone = status === "fresh" ? "petrol" : status === "ageing" ? "amber" : status === "stale" ? "alarm" : "outline"
  return <Pill tone={tone} title={title}>{FRESHNESS_LABEL[status]}</Pill>
}

export const EXC_LABEL: Record<ExceptionStatus, string> = {
  requested: "Awaiting approval", approved: "Approved", rejected: "Rejected", revoked: "Revoked", expired: "Expired",
}

export function ExceptionPill({ status }: { status: ExceptionStatus }) {
  const tone = status === "approved" ? "petrol" : status === "requested" ? "brass" : status === "expired" ? "alarm" : "outline"
  return <Pill tone={tone}>{EXC_LABEL[status]}</Pill>
}

export function fmtKpi(v: number | null | undefined, unit: KpiUnit): string {
  if (v == null) return "–"
  const n = Math.abs(v) >= 100 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)
  if (unit === "%") return `${n}%`
  if (unit === "EUR") return `€${Number(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
  if (unit === "count") return n
  return `${n} ${unit === "days" ? "d" : "h"}`
}

export function KpiStatusPill({ status, stale }: { status: KpiStatus; stale?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {status === "met" && <Pill tone="petrol">On target</Pill>}
      {status === "missed" && <Pill tone="alarm">Below target</Pill>}
      {status === "no_data" && <Pill tone="outline">No data</Pill>}
      {status === "no_target" && <Pill tone="neutral">No target</Pill>}
      {stale && status !== "no_data" && <Pill tone="amber" title="No value for the last completed period">Overdue entry</Pill>}
    </span>
  )
}

/** Horizontal legend item. */
export function LegendSwatch({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block size-3 rounded-[3px]", className)} aria-hidden />
      {children}
    </span>
  )
}

export function daysLabel(n: number): string {
  if (n === 0) return "today"
  if (n === 1) return "tomorrow"
  if (n === -1) return "yesterday"
  return n > 0 ? `in ${n} days` : `${-n} days ago`
}

export function daysFromToday(d: string): number {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  const x = new Date(`${d}T00:00:00`)
  return Math.round((x.getTime() - t.getTime()) / 86_400_000)
}
