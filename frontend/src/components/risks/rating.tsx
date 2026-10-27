import type { KeyboardEvent } from "react"
import { cn } from "@/lib/utils"
import type { ScaleStep } from "./shared"

/** 1–5 rating as a segmented control with the method's labels; arrow keys move the choice. */
export function RatingPicker({ label, scale, value, onChange, disabled, id }: {
  label: string
  scale: ScaleStep[]
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
  id: string
}) {
  const current = value ? scale[value - 1] : null
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    let next: number | null = null
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(5, (value ?? 0) + 1)
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, (value ?? 2) - 1)
    if (next == null) return
    e.preventDefault()
    onChange(next)
    e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]")[next - 1]?.focus()
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span id={`${id}-label`} className="text-[12.5px] font-medium text-ink-2">{label}</span>
        {value != null && !disabled && (
          <button type="button" className="text-[11.5px] text-ink-3 hover:text-ink" onClick={() => onChange(null)}>Clear</button>
        )}
      </div>
      <div role="radiogroup" aria-labelledby={`${id}-label`} onKeyDown={onKey}
        className={cn("grid grid-cols-5 gap-0.5 rounded-md border bg-surface p-0.5", disabled && "opacity-70")}>
        {scale.map((s, idx) => {
          const v = idx + 1
          const active = value === v
          return (
            <button key={v} type="button" role="radio" aria-checked={active} disabled={disabled}
              tabIndex={active || (value == null && v === 1) ? 0 : -1}
              title={s.description ?? undefined}
              onClick={() => onChange(active ? null : v)}
              className={cn("flex min-w-0 flex-col items-center rounded-[4px] px-1 py-1 leading-tight transition-colors",
                active ? "bg-petrol text-primary-foreground" : "text-ink-2 hover:bg-muted", disabled && "cursor-default hover:bg-transparent")}>
              <span className="tabular text-[13px] font-semibold">{v}</span>
              <span className={cn("w-full truncate text-center text-[11px]", active ? "opacity-90" : "text-ink-3")}>{s.label}</span>
            </button>
          )
        })}
      </div>
      <p className="min-h-[18px] text-[12px] text-ink-3">{current?.description ?? (value ? "" : "Not rated yet")}</p>
    </div>
  )
}
