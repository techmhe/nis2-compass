import { useQuery } from "@tanstack/react-query"
import { answerTone } from "@/components/common/fields"
import { Pill } from "@/components/common/basics"
import { api } from "@/lib/api"
import type { ActionItem, AnswerRow, Chapter, DocLink, ProvisionLink, Requirement } from "@/lib/types"
import { cn } from "@/lib/utils"

/* ---------- API payloads not covered by lib/types ---------- */

export interface RequirementDetailResp {
  requirement: Requirement
  chapter: Chapter
  provisions: ProvisionLink[]
  answers: {
    answer_id: number
    assessment_id: number
    entity: { id: number; code: string; name: string }
    scope: string
    implemented: string | null
    documented: string | null
    effectiveness: string | null
    score: number | null
    wp_required: boolean | null
    finding_id: string | null
    evidence: string | null
    gap_description: string | null
    recommended_action: string | null
    responsible: string | null
    updated_at: string
  }[]
  action_items: { id: number; code: string; title: string; status: string; priority: string; entity_code: string; target_date: string | null }[]
  documents: DocLink[]
  round_id: number | null
}

export interface TargetChange {
  id: number
  chapter: string
  old_target: number
  new_target: number
  reason: string
  changed_at: string
  changed_by: string | null
}

export interface ActionItemDetailResp {
  item: ActionItem
  answer_id: number | null
  assessment_id: number | null
  documents: DocLink[]
}

/* ---------- queries shared by the assessment screens ---------- */

export function useChapters(enabled = true) {
  return useQuery({ queryKey: ["chapters"], queryFn: () => api.get<Chapter[]>("/chapters"), staleTime: 5 * 60_000, enabled })
}

export function useRequirements(enabled = true) {
  return useQuery({ queryKey: ["requirements"], queryFn: () => api.get<Requirement[]>("/requirements"), staleTime: 5 * 60_000, enabled })
}

/* ---------- client copy of the workbook formulas (for instant feedback; the server stays authoritative) ---------- */

const POINTS: Record<string, number> = { Yes: 1, Effective: 1, Partial: 0.5, "Not Tested": 0.25, No: 0, Ineffective: 0 }

export function scoreAnswer(a: Pick<AnswerRow, "scope" | "implemented" | "documented" | "effectiveness">): number | null {
  if (a.scope !== "In Scope") return null
  const counted = [a.implemented, a.documented, a.effectiveness].filter((v): v is string => !!v && v !== "N/A")
  if (!counted.length) return null
  return counted.reduce((s, v) => s + (POINTS[v] ?? 0), 0) / counted.length
}

export function wpRequired(a: Pick<AnswerRow, "scope" | "implemented" | "documented" | "effectiveness">): boolean | null {
  if (a.scope !== "In Scope" || !(a.implemented || a.documented || a.effectiveness)) return null
  if (["No", "Partial"].includes(a.implemented ?? "") || ["No", "Partial"].includes(a.documented ?? "")) return true
  return ["Partial", "Not Tested", "Ineffective"].includes(a.effectiveness ?? "")
}

/** Apply a change to a row and recompute score / work package / finding id locally. */
export function applyLocal(row: AnswerRow, changes: Partial<AnswerRow>, prefix: string | undefined): AnswerRow {
  const next = { ...row, ...changes }
  next.score = scoreAnswer(next)
  next.wp_required = wpRequired(next)
  next.finding_id = next.wp_required && prefix ? `${prefix}-${next.number}` : null
  return next
}

export interface LiveStats {
  total: number
  inScope: number
  assessed: number
  average: number | null
  findings: number
  coreTotal: number
  coreAssessed: number
  reviewed: number
}

export function computeStats(rows: AnswerRow[]): LiveStats {
  let inScope = 0, assessed = 0, findings = 0, coreTotal = 0, coreAssessed = 0, reviewed = 0, sum = 0, n = 0
  for (const r of rows) {
    if (r.scope === "In Scope") {
      inScope++
      if (r.is_core) coreTotal++
      if (r.implemented) {
        assessed++
        if (r.is_core) coreAssessed++
      }
    }
    if (r.wp_required) findings++
    if (r.review_status === "reviewed") reviewed++
    if (r.score != null) { sum += r.score; n++ }
  }
  return { total: rows.length, inScope, assessed, average: n ? sum / n : null, findings, coreTotal, coreAssessed, reviewed }
}

/* ---------- small visual pieces ---------- */

const LETTERS = [["implemented", "I", "Implemented"], ["documented", "D", "Documented"], ["effectiveness", "E", "Effectiveness"]] as const

/** Compact Implemented / Documented / Effectiveness indicator: three letter tiles coloured by answer. */
export function IdeTiles({ row, className }: {
  row: { scope?: string | null; implemented?: string | null; documented?: string | null; effectiveness?: string | null }
  className?: string
}) {
  const outOfScope = row.scope != null && row.scope !== "In Scope"
  const label = LETTERS.map(([k, , name]) => `${name}: ${row[k] ?? "not answered"}`).join(", ")
  return (
    <span className={cn("inline-flex gap-[3px]", outOfScope && "opacity-40", className)} aria-label={label} title={label}>
      {LETTERS.map(([k, letter]) => {
        const v = row[k]
        const filled = !!v && v !== "N/A"
        return (
          <span key={k}
            className={cn("flex size-[15px] items-center justify-center rounded-[3px] font-mono text-[9.5px] leading-none font-semibold",
              filled ? "text-white" : v === "N/A" ? "border border-dashed border-ink-3/60 text-ink-3" : "border text-ink-3/70")}
            style={filled ? { background: answerTone(v) } : undefined}>
            {letter}
          </span>
        )
      })}
    </span>
  )
}

export function ScopePill({ scope }: { scope: string | null | undefined }) {
  if (!scope || scope === "In Scope") return null
  return scope === "Central at HQ" ? <Pill tone="brass">Central at HQ</Pill> : <Pill tone="outline">Not applicable</Pill>
}

export function CorePill({ className }: { className?: string }) {
  return <Pill tone="petrol" className={className} title="Core requirement">Core</Pill>
}

export const REGISTRATION_STATUS: Record<string, string> = {
  not_registered: "Not registered", submitted: "Submitted", confirmed: "Confirmed",
}

export const RELATION_LABEL: Record<string, string> = {
  benchmark: "Benchmark", legal_basis: "Legal basis", national_equivalent: "National equivalent", iso_mapping: "ISO mapping", related: "Related",
}

/** Friendly field names for revision diffs. */
export const FIELD_LABEL: Record<string, string> = {
  scope: "Scope", implemented: "Implemented", documented: "Documented", effectiveness: "Effectiveness", evidence: "Evidence",
  gap_description: "Gap description", recommended_action: "Recommended action", responsible_id: "Responsible", target_date: "Target date",
  effort: "Effort", notes: "Internal notes", review_status: "Review status",
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  const role = el.getAttribute("role")
  return role === "combobox" || role === "textbox" || role === "listbox" || role === "option" || role === "menuitem"
}

/** Keeps an optional preference in localStorage; storage may be unavailable. */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}
