import { Fragment } from "react"
import { Lock } from "lucide-react"
import { Pill } from "@/components/common/basics"
import { fmtDate } from "@/lib/format"
import type { DocumentItem } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Payload accepted by PUT /documents/{id} (DocumentMeta on the server). */
export interface DocumentMetaIn {
  title: string
  description: string | null
  doc_type: string
  status: string
  classification: string
  entity_id: number | null
  folder_id: number | null
  owner_id: number | null
  tags: string[]
  version_label: string | null
  approved_at: string | null
  approved_by: string | null
  next_review_date: string | null
  external_url: string | null
}

export interface DocumentsMeta {
  types: string[]
  statuses: string[]
  classifications: string[]
  max_upload_mb: number
  allowed_extensions: string[]
}

export const DOC_STATUSES = ["Draft", "In Review", "Approved", "Retired"] as const

/** Full metadata of a document, as needed for a PUT that changes only some fields. */
export function metaOf(d: DocumentItem): DocumentMetaIn {
  return {
    title: d.title,
    description: d.description,
    doc_type: d.doc_type,
    status: d.status,
    classification: d.classification,
    entity_id: d.entity?.id ?? null,
    folder_id: d.folder_id,
    owner_id: d.owner?.id ?? null,
    tags: d.tags ?? [],
    version_label: d.version_label,
    approved_at: d.approved_at,
    approved_by: d.approved_by,
    next_review_date: d.next_review_date,
    external_url: d.external_url,
  }
}

/**
 * Renders search snippets in which the server marks matches as «term».
 * Everything is rendered as text (never HTML), so snippets cannot inject markup.
 */
export function Highlight({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null
  const parts = text.split(/(«[^»]*»)/g)
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.startsWith("«") && p.endsWith("»") ? (
          <mark key={i} className="rounded-[2px] bg-brass-50 px-0.5 text-ink [box-decoration-break:clone]">{p.slice(1, -1)}</mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </span>
  )
}

/** Highlights every case-insensitive occurrence of `term` in plain text. */
export function HighlightTerm({ text, term, activeIndex, markRef }: {
  text: string
  term: string
  activeIndex?: number
  markRef?: (el: HTMLElement | null, index: number) => void
}) {
  const t = term.trim()
  if (t.length < 2) return <>{text}</>
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const parts = text.split(new RegExp(`(${esc})`, "gi"))
  let n = -1
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 1) {
          n += 1
          const idx = n
          return (
            <mark key={i} ref={(el) => markRef?.(el, idx)}
              className={cn("rounded-[2px] px-0.5 text-ink", idx === activeIndex ? "bg-brass/40" : "bg-brass-50")}>{p}</mark>
          )
        }
        return <Fragment key={i}>{p}</Fragment>
      })}
    </>
  )
}

export function Classification({ value, className }: { value: string; className?: string }) {
  const sensitive = value === "Confidential" || value === "Restricted"
  return (
    <span className={cn("inline-flex items-center gap-1 text-[12.5px]", sensitive ? "text-ink" : "text-ink-2", className)}>
      {sensitive && <Lock className="size-3 text-ink-3" aria-hidden />}
      {value}
    </span>
  )
}

export function ReviewDate({ date, overdue }: { date: string | null; overdue: boolean }) {
  if (!date) return <span className="text-ink-3">–</span>
  const label = fmtDate(date)
  return overdue ? (
    <Pill tone="alarm" title="Review overdue">{label}</Pill>
  ) : (
    <span className="tabular text-[12.5px] text-ink-2">{label}</span>
  )
}

export const LINK_TYPE_LABEL: Record<string, string> = {
  requirement: "Requirements",
  answer: "Assessment answers",
  action_item: "Action plan items",
  work_package: "Work packages",
  task: "Tasks",
  provision: "Regulation provisions",
  incident: "Incidents",
  activity: "Project activities",
  gate: "Project gates",
  raid: "RAID records",
  document: "Documents",
}

export function parseTags(s: string): string[] {
  return Array.from(new Set(s.split(",").map((t) => t.trim()).filter(Boolean)))
}
