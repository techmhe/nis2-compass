import { useEffect, useState } from "react"
import { format } from "date-fns"
import { Pill } from "@/components/common/basics"
import { toDate } from "@/lib/format"
import type { Incident } from "@/lib/types"
import { cn } from "@/lib/utils"
import type { IncidentX } from "./reporting-types"

/** Payload accepted by POST/PUT /incidents (IncidentIn on the server). */
export interface IncidentIn {
  entity_id: number | null
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
  handler_id: number | null
}

export const INCIDENT_FIELDS: (keyof IncidentIn)[] = [
  "entity_id", "title", "description", "category", "severity", "status", "is_significant", "significance_rationale",
  "detected_at", "aware_at", "early_warning_at", "notification_at", "intermediate_report_at", "final_report_at", "authority",
  "authority_reference", "suspected_malicious", "cross_border_impact", "impact", "indicators_of_compromise", "root_cause",
  "measures", "lessons_learned", "handler_id",
]

export function incidentBody(i: Incident): IncidentIn {
  const out = {} as Record<string, unknown>
  for (const k of INCIDENT_FIELDS) out[k] = k === "entity_id" ? i.entity?.id ?? null : (i as unknown as Record<string, unknown>)[k] ?? null
  return out as unknown as IncidentIn
}

export const CATEGORIES = [
  "Phishing", "Malware", "Ransomware", "Denial of service", "Unauthorised access", "Data breach", "Account compromise",
  "System failure", "Supplier incident", "Physical incident", "Other",
]

export function SeverityPill({ value }: { value: string }) {
  if (value === "Critical") return <Pill className="border-transparent bg-alarm text-white">Critical</Pill>
  const tone = value === "High" ? "alarm" : value === "Medium" ? "amber" : "neutral"
  return <Pill tone={tone}>{value}</Pill>
}

export function SignificantTag({ value }: { value: boolean | null }) {
  if (value === true) return <Pill tone="alarm" title="Significant incident under NIS-2 Art. 23(3): reporting obligations apply">Significant</Pill>
  if (value === false) return <span className="text-[12.5px] text-ink-3">Not significant</span>
  return <Pill tone="amber" title="Significance has not been assessed yet">Not assessed</Pill>
}

/** Re-render every `ms` so countdowns stay current. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return now
}

/** "3 d 4 h", "5 h 20 min", "12 min" */
export function duration(msAbs: number): string {
  const min = Math.max(0, Math.round(msAbs / 60_000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return h ? `${d} d ${h} h` : `${d} d`
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`
  return `${m} min`
}

export type Step = Incident["reporting"][number]

/** The next reporting step that is still open, or a summary state. */
export function clockSummary(i: Incident, now: number): { tone: "alarm" | "amber" | "petrol" | "neutral" | "muted"; label: string; title?: string } {
  const x = i as IncidentX
  if (x.track_count) {
    // per-entity report tracks (incident reporting module) take precedence over the single legacy clock
    const n = x.next_deadline
    if (!n) return { tone: "petrol", label: "All reports submitted" }
    const due = toDate(n.due_at)!.getTime()
    const where = `${n.entity_code}, ${n.authority}`
    if (due < now) return { tone: "alarm", label: `${n.label} overdue by ${duration(now - due)}`, title: `${where}; due ${fmtDue(n.due_at)}` }
    return { tone: due - now < 12 * 3_600_000 ? "amber" : "neutral", label: `${n.label} due in ${duration(due - now)}`, title: `${where}; due ${fmtDue(n.due_at)}` }
  }
  if (i.is_significant === false) return { tone: "muted", label: "No reporting duty" }
  if (i.is_significant == null) return { tone: "amber", label: "Assess significance" }
  if (!i.aware_at) return { tone: "amber", label: "Awareness time missing", title: "The 24 h / 72 h clock starts when the entity becomes aware of the incident" }
  const open = i.reporting.find((s) => !s.done_at)
  if (!open) return { tone: "petrol", label: "All reports sent" }
  const due = toDate(open.due)!.getTime()
  const name = open.key === "early_warning" ? "Early warning" : open.key === "notification" ? "Notification" : "Final report"
  if (due < now) return { tone: "alarm", label: `${name} overdue by ${duration(now - due)}`, title: `Due ${fmtDue(open.due)}` }
  return { tone: due - now < 12 * 3_600_000 ? "amber" : "neutral", label: `${name} due in ${duration(due - now)}`, title: `Due ${fmtDue(open.due)}` }
}

export function ClockBadge({ incident, now }: { incident: Incident; now: number }) {
  const s = clockSummary(incident, now)
  if (s.tone === "muted") return <span className="text-[12.5px] text-ink-3">{s.label}</span>
  return <Pill tone={s.tone} title={s.title} className={cn("tabular")}>{s.label}</Pill>
}

export function fmtDue(v: string | null | undefined) {
  const d = toDate(v)
  return d ? format(d, "EEE d MMM yyyy, HH:mm") : "–"
}

/** ISO timestamp -> value for <input type="datetime-local"> in local time. */
export function toLocalInput(v: string | null | undefined): string {
  const d = toDate(v)
  return d ? format(d, "yyyy-MM-dd'T'HH:mm") : ""
}

/** datetime-local value -> ISO timestamp (keeps the original when the minute did not change). */
export function fromLocalInput(v: string, original?: string | null): string | null {
  if (!v) return null
  if (original && toLocalInput(original) === v) return original
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
