import type { ReactNode } from "react"
import { AlertTriangle, Inbox, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { pct, scoreColor } from "@/lib/format"

/** Page title row. Title is a plain heading; actions sit on the right. */
export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-[75ch] text-[13.5px] text-ink-3">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Section({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn("rounded-md border bg-card", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  )
}

/** Requirement numbers, codes and legal references: monospace because they are identifiers. */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12.5px] tracking-tight text-ink-2", className)}>{children}</span>
}

const TONE: Record<string, string> = {
  neutral: "bg-muted text-ink-2 border-transparent",
  petrol: "bg-petrol-50 text-petrol border-transparent",
  brass: "bg-brass-50 text-brass border-transparent",
  alarm: "bg-alarm-50 text-alarm border-transparent",
  amber: "bg-amber-50 text-amber border-transparent",
  sage: "bg-sage-50 text-sage border-transparent",
  outline: "bg-transparent text-ink-2 border-border",
}

export function Pill({ tone = "neutral", children, className, title }: { tone?: keyof typeof TONE | string; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-[4px] border px-1.5 text-[11.5px] leading-none font-medium whitespace-nowrap",
        TONE[tone] ?? TONE.neutral,
        className,
      )}
    >
      {children}
    </span>
  )
}

const STATUS_TONE: Record<string, string> = {
  // generic workflow
  "Not Started": "neutral", "In Progress": "petrol", Completed: "sage", Blocked: "alarm", Deferred: "brass",
  Cancelled: "outline",
  // schedule
  Green: "sage", Amber: "amber", Red: "alarm", "Not Planned": "outline",
  // due
  Overdue: "alarm", "Due soon": "amber", "On track": "sage", Closed: "outline",
  // RAID
  Open: "amber", Accepted: "neutral", Escalated: "alarm",
  // priority
  High: "alarm", Medium: "amber", Low: "neutral",
  // tasks
  todo: "neutral", in_progress: "petrol", review: "brass", done: "sage", blocked: "alarm",
  // assessment
  not_started: "neutral", in_review: "brass", completed: "sage",
  // documents
  Draft: "neutral", "In Review": "brass", Approved: "sage", Retired: "outline",
  // incidents
  Contained: "brass", Resolved: "sage", Critical: "alarm",
}

const STATUS_LABEL: Record<string, string> = {
  todo: "To do", in_progress: "In progress", review: "Review", done: "Done", blocked: "Blocked",
  not_started: "Not started", in_review: "In review", completed: "Completed",
}

export function StatusPill({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-ink-3">–</span>
  return (
    <Pill tone={STATUS_TONE[value] ?? "neutral"} className={className}>
      {STATUS_LABEL[value] ?? value}
    </Pill>
  )
}

export function PriorityPill({ value }: { value: string | null | undefined }) {
  if (!value) return null
  const dot = value === "High" ? "bg-alarm" : value === "Medium" ? "bg-amber" : "bg-ink-3"
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {value}
    </span>
  )
}

/** Horizontal score bar with target tick. */
export function ScoreBar({ value, target, className, showLabel = true }: { value: number | null | undefined; target?: number; className?: string; showLabel?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative h-1.5 flex-1 overflow-visible rounded-full bg-muted">
        {value != null && (
          <div className="h-full rounded-full" style={{ width: `${Math.max(2, value * 100)}%`, background: scoreColor(value) }} />
        )}
        {target != null && (
          <div className="absolute -top-1 h-3.5 w-[2px] rounded bg-brass" style={{ left: `calc(${target * 100}% - 1px)` }} title={`Target ${pct(target)}`} />
        )}
      </div>
      {showLabel && <span className="tabular w-9 text-right text-[12.5px] text-ink-2">{pct(value)}</span>}
    </div>
  )
}

export function ScoreChip({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="tabular text-[12.5px] text-ink-3">–</span>
  return (
    <span className="tabular inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
      <span className="size-2 rounded-[2px]" style={{ background: scoreColor(value) }} />
      {pct(value)}
    </span>
  )
}

export function Meter({ value, className, tone = "petrol" }: { value: number; className?: string; tone?: "petrol" | "brass" | "alarm" }) {
  const color = tone === "petrol" ? "bg-petrol" : tone === "brass" ? "bg-brass" : "bg-alarm"
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  )
}

export function Loading({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 p-6 text-[13px] text-ink-3", className)}>
      <Loader2 className="size-4 animate-spin" /> {label}…
    </div>
  )
}

export function ErrorState({ error, className }: { error: unknown; className?: string }) {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <div className={cn("flex items-start gap-2 rounded-md border border-alarm/30 bg-alarm-50 p-3 text-[13px] text-alarm", className)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{msg}</span>
    </div>
  )
}

export function Empty({ title, children, action, className, icon }: { title: string; children?: ReactNode; action?: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      <div className="text-ink-3">{icon ?? <Inbox className="size-6" />}</div>
      <div className="text-[14px] font-medium text-ink">{title}</div>
      {children && <div className="max-w-[48ch] text-[13px] text-ink-3">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function KV({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[minmax(110px,34%)_1fr] gap-3 py-1.5 text-[13px]", className)}>
      <div className="text-ink-3">{label}</div>
      <div className="min-w-0 break-words text-ink">{children ?? <span className="text-ink-3">–</span>}</div>
    </div>
  )
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "alarm" | "amber" | "petrol" }) {
  return (
    <div className="min-w-0">
      <div className="text-[12.5px] text-ink-3">{label}</div>
      <div className={cn("tabular text-[22px] leading-tight font-semibold",
        tone === "alarm" ? "text-alarm" : tone === "amber" ? "text-amber" : tone === "petrol" ? "text-petrol" : "text-ink")}>
        {value}
      </div>
      {hint && <div className="text-[12px] text-ink-3">{hint}</div>}
    </div>
  )
}

export function EntityTag({ code, name, className }: { code: string; name?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-[4px] border bg-surface px-1.5 font-mono text-[11.5px] leading-5 text-ink-2", className)} title={name}>
      {code}
    </span>
  )
}
