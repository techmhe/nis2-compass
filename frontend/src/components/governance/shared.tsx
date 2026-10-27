import { useMemo, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Pill } from "@/components/common/basics"
import { OptionSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { fmtDate, toDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  LEGAL_STATUS_LABEL, TRAINING_LABEL,
  type DueState, type EntityLegalResp, type GovOverview, type LegalTag, type TrainingState,
} from "./types"

/* ---------- queries ---------- */

export const govKeys = {
  all: ["gov"] as const,
  overview: ["gov", "overview"] as const,
  obligations: ["gov", "obligations"] as const,
  changes: ["gov", "changes"] as const,
  registrations: ["gov", "registrations"] as const,
  registration: (id: number) => ["gov", "registration", id] as const,
  members: ["gov", "members"] as const,
  matrix: ["gov", "matrix"] as const,
  decisions: ["gov", "decisions"] as const,
  decision: (id: number) => ["gov", "decision", id] as const,
  trainings: ["gov", "trainings"] as const,
  training: (id: number) => ["gov", "training", id] as const,
  rules: ["gov", "rules"] as const,
  profiles: ["gov", "profiles"] as const,
  legal: ["gov-legal", "all"] as const,
  entityLegal: (id: number) => ["gov-legal", "entity", id] as const,
  requirementLegal: (id: number) => ["gov-legal", "requirement", id] as const,
  gaps: ["gov-legal", "gaps"] as const,
}

export function useGovOverview() {
  const { canAny } = useAuth()
  return useQuery({ queryKey: govKeys.overview, queryFn: () => api.get<GovOverview>("/governance/overview"), enabled: canAny("governance.read") })
}

/** Effective legal status of every requirement for one entity (map by requirement id). */
export function useEntityLegal(entityId: number | null | undefined) {
  const { canAny } = useAuth()
  const q = useQuery({
    queryKey: govKeys.entityLegal(entityId ?? 0),
    queryFn: () => api.get<EntityLegalResp>(`/governance/legal/entities/${entityId}`),
    enabled: entityId != null && canAny("catalog.read"),
    staleTime: 5 * 60_000,
  })
  const map = useMemo(() => new Map((q.data?.items ?? []).map((t) => [t.requirement_id, t])), [q.data])
  return { ...q, map }
}

/** All tags of all jurisdictions, grouped by requirement id. */
export function useLegalTags() {
  const { canAny } = useAuth()
  const q = useQuery({ queryKey: govKeys.legal, queryFn: () => api.get<LegalTag[]>("/governance/legal"), enabled: canAny("catalog.read"), staleTime: 5 * 60_000 })
  const byReq = useMemo(() => {
    const m = new Map<number, Partial<Record<LegalTag["jurisdiction"], LegalTag>>>()
    for (const t of q.data ?? []) {
      const cur = m.get(t.requirement_id) ?? {}
      cur[t.jurisdiction] = t
      m.set(t.requirement_id, cur)
    }
    return m
  }, [q.data])
  return { ...q, byReq }
}

/* ---------- legal badges ---------- */

export function legalText(tag: LegalTag): string {
  if (tag.status === "binding") return tag.basis_label ? `Binding (${tag.basis_label})` : "Binding"
  if (tag.status === "benchmark") return tag.basis_label ? `Benchmark – basis ${tag.basis_label}` : "Benchmark"
  return tag.basis_label ? `Guidance – ${tag.basis_label}` : "Guidance"
}

const LEGAL_TONE: Record<string, string> = { binding: "petrol", benchmark: "outline", guidance: "neutral" }

/** "Binding (Cbb Art. 9)" / "Benchmark – basis § 30(2) Nr. 3 BSIG". */
export function LegalBadge({ tag, prefix, className, short }: { tag: LegalTag; prefix?: ReactNode; className?: string; short?: boolean }) {
  const label = short ? LEGAL_STATUS_LABEL[tag.status] : legalText(tag)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex min-w-0 rounded-[4px] focus-visible:ring-2 focus-visible:ring-petrol/40 focus-visible:outline-none">
          <Pill tone={LEGAL_TONE[tag.status]} className={cn("max-w-full", className)}>
            {prefix}
            <span className="truncate">{label}</span>
          </Pill>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[360px]">
        <div className="font-medium">{legalText(tag)}{tag.jurisdiction === "EU" ? " (IR 2024/2690)" : ` in ${tag.jurisdiction}`}</div>
        {tag.note && <div className="mt-1 opacity-90">{tag.note}</div>}
        {!tag.is_auto && <div className="mt-1 opacity-75">Curated manually</div>}
      </TooltipContent>
    </Tooltip>
  )
}

/** Badge with the effective status of a requirement for an entity (loads the entity map once, cached). */
export function EntityLegalBadge({ entityId, requirementId, short, className }: { entityId: number; requirementId: number; short?: boolean; className?: string }) {
  const { map } = useEntityLegal(entityId)
  const tag = map.get(requirementId)
  if (!tag) return null
  return <LegalBadge tag={tag} short={short} className={className} />
}

/** Tiny marker for dense lists: filled petrol square = binding, outlined = benchmark. */
export function LegalDot({ tag }: { tag: LegalTag | undefined }) {
  if (!tag) return null
  return (
    <span title={legalText(tag)} aria-label={legalText(tag)}
      className={cn("inline-block size-2 shrink-0 rounded-[2px]", tag.status === "binding" ? "bg-petrol" : "border border-ink-3/60")} />
  )
}

/* ---------- status pills ---------- */

export function DueBadge({ state, className }: { state: DueState | "reported"; className?: string }) {
  const map: Record<string, [string, string]> = {
    overdue: ["alarm", "Overdue"], due_soon: ["amber", "Due soon"], open: ["neutral", "Open"], done: ["sage", "Done"], reported: ["sage", "Reported"],
  }
  const [tone, label] = map[state] ?? ["neutral", state]
  return <Pill tone={tone} className={className}>{label}</Pill>
}

export function TrainingPill({ status }: { status: TrainingState }) {
  const tone = status === "compliant" ? "sage" : status === "due" ? "amber" : status === "overdue" ? "alarm" : "outline"
  return <Pill tone={tone}>{TRAINING_LABEL[status]}</Pill>
}

export function daysFrom(d: string | null | undefined): number | null {
  const dt = toDate(d)
  if (!dt) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((dt.getTime() - today.getTime()) / 86_400_000)
}

/** "in 5 days" / "5 days overdue" / "today". */
export function relDue(d: string | null | undefined): string {
  const n = daysFrom(d)
  if (n == null) return ""
  if (n === 0) return "due today"
  if (n === 1) return "due tomorrow"
  if (n > 0) return `in ${n} days`
  return n === -1 ? "1 day overdue" : `${-n} days overdue`
}

export function DueDate({ date, done, className }: { date: string; done?: boolean; className?: string }) {
  const n = daysFrom(date)
  return (
    <span className={cn("tabular text-[12.5px]", className)}>
      <span className="text-ink">{fmtDate(date)}</span>
      {!done && n != null && <span className={cn("block text-[11.5px]", n < 0 ? "text-alarm" : n <= 30 ? "text-amber" : "text-ink-3")}>{relDue(date)}</span>}
    </span>
  )
}

/* ---------- inputs ---------- */

/** One value per line (IP ranges, domains, topics ...). Uncontrolled text; remount (key) to reset. */
export function LinesInput({ value, onChange, placeholder, rows = 3, id, disabled }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string; rows?: number; id?: string; disabled?: boolean
}) {
  const [text, setText] = useState(() => value.join("\n"))
  return (
    <Textarea id={id} rows={rows} value={text} placeholder={placeholder} disabled={disabled} className="font-mono text-[12.5px]"
      onChange={(e) => { setText(e.target.value); onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean)) }} />
  )
}

export function EntityFilter({ value, onChange, className }: { value: number | null; onChange: (v: number | null) => void; className?: string }) {
  const { data = [] } = useEntities()
  const { can } = useAuth()
  const visible = data.filter((e) => e.is_active && can("governance.read", e.id))
  return (
    <OptionSelect className={className} value={value != null ? String(value) : null} onChange={(v) => onChange(v ? Number(v) : null)}
      allowNone noneLabel="All entities" placeholder="All entities"
      options={visible.map((e) => ({ value: String(e.id), label: <span><span className="font-mono text-[12px] text-ink-3">{e.code}</span> {e.name}</span> }))} />
  )
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button size="icon-xs" variant="ghost" className={className} aria-label={label} disabled={!text}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) },
          () => toast.error("The browser did not allow copying to the clipboard"))
      }}>
      {done ? <Check className="text-sage" /> : <Copy />}
    </Button>
  )
}

/** Small uppercase-free label/value line for detail panes. */
export function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="text-[13px] break-words text-ink">{children ?? <span className="text-ink-3">–</span>}</div>
    </div>
  )
}

/** Compact per-jurisdiction status for catalogue rows: "DE binding", "NL benchmark". */
export function JurisdictionPills({ tags }: { tags: Partial<Record<"DE" | "NL" | "EU", LegalTag>> | undefined }) {
  if (!tags) return null
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {(["DE", "NL"] as const).map((j) => tags[j] && (
        <span key={j} title={`${j}: ${legalText(tags[j]!)}`}>
          <Pill tone={LEGAL_TONE[tags[j]!.status]} className="h-4 px-1 text-[10.5px]">{j} {LEGAL_STATUS_LABEL[tags[j]!.status].toLowerCase()}</Pill>
        </span>
      ))}
    </span>
  )
}
