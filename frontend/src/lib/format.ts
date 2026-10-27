import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns"

export function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = typeof v === "string" ? parseISO(v) : v
  return isValid(d) ? d : null
}

export function fmtDate(v: string | Date | null | undefined, fallback = "–"): string {
  const d = toDate(v)
  return d ? format(d, "d MMM yyyy") : fallback
}

export function fmtDateShort(v: string | Date | null | undefined, fallback = "–"): string {
  const d = toDate(v)
  return d ? format(d, "d MMM") : fallback
}

export function fmtDateTime(v: string | Date | null | undefined, fallback = "–"): string {
  const d = toDate(v)
  return d ? format(d, "d MMM yyyy, HH:mm") : fallback
}

export function fromNow(v: string | Date | null | undefined): string {
  const d = toDate(v)
  return d ? formatDistanceToNowStrict(d, { addSuffix: true }) : "–"
}

export function pct(v: number | null | undefined, digits = 0, fallback = "–"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return fallback
  return `${(v * 100).toFixed(digits)}%`
}

/** Discrete score colour (0..1) on the alarm → petrol scale. */
export function scoreColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return "var(--line)"
  const idx = Math.min(5, Math.max(0, Math.floor(v * 5.999)))
  return `var(--score-${idx})`
}

export function initials(name: string): string {
  return name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("")
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function isoDate(d: Date): string {
  return format(d, "yyyy-MM-dd")
}
