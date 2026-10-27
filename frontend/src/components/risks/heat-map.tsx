import { cn } from "@/lib/utils"
import { LEVEL_CELL, LEVEL_LABEL, LEVELS, type Level, type RiskMethod } from "./shared"

const ROWS = [5, 4, 3, 2, 1] // likelihood, top = highest
const COLS = [1, 2, 3, 4, 5] // impact

/** 5 x 5 risk matrix: likelihood (rows) x impact (columns), cells coloured by the method's levels. */
export function RiskHeatMap({ method, cells, selected, onSelect, size = "md", markers }: {
  method: RiskMethod
  cells?: number[][]
  selected?: { l: number; i: number } | null
  onSelect?: (cell: { l: number; i: number } | null) => void
  size?: "sm" | "md"
  markers?: { l: number | null; i: number | null; label: string; title: string; solid?: boolean }[]
}) {
  const sm = size === "sm"
  return (
    <div className="flex gap-2">
      <div className="flex items-center">
        <span className="-rotate-180 text-[11.5px] text-ink-3 [writing-mode:vertical-rl]">Likelihood</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("grid gap-[3px]", sm ? "grid-cols-[64px_repeat(5,minmax(0,1fr))]" : "grid-cols-[112px_repeat(5,minmax(0,1fr))]")}>
          {ROWS.map((l) => (
            <Row key={l} l={l} method={method} cells={cells} selected={selected} onSelect={onSelect} sm={sm} markers={markers} />
          ))}
          <div />
          {COLS.map((i) => (
            <div key={i} className="px-0.5 pt-1 text-center text-[11.5px] leading-tight text-ink-3" title={method.impact_scale[i - 1]?.description ?? undefined}>
              <span className="tabular text-ink-2">{i}</span>
              {!sm && <span className="block truncate">{method.impact_scale[i - 1]?.label}</span>}
            </div>
          ))}
        </div>
        <div className="mt-0.5 text-center text-[11.5px] text-ink-3">Impact</div>
      </div>
    </div>
  )
}

function Row({ l, method, cells, selected, onSelect, sm, markers }: {
  l: number
  method: RiskMethod
  cells?: number[][]
  selected?: { l: number; i: number } | null
  onSelect?: (cell: { l: number; i: number } | null) => void
  sm: boolean
  markers?: { l: number | null; i: number | null; label: string; title: string; solid?: boolean }[]
}) {
  return (
    <>
      <div className="flex items-center justify-end gap-1.5 pr-1 text-right text-[11.5px] leading-tight text-ink-3" title={method.likelihood_scale[l - 1]?.description ?? undefined}>
        {!sm && <span className="truncate">{method.likelihood_scale[l - 1]?.label}</span>}
        <span className="tabular text-ink-2">{l}</span>
      </div>
      {COLS.map((i) => {
        const level = method.matrix[l - 1][i - 1]
        const n = cells?.[l - 1]?.[i - 1] ?? 0
        const isSel = selected?.l === l && selected?.i === i
        const here = (markers ?? []).filter((m) => m.l === l && m.i === i)
        const label = `Likelihood ${l} (${method.likelihood_scale[l - 1]?.label}), impact ${i} (${method.impact_scale[i - 1]?.label}): ${LEVEL_LABEL[level]}${cells ? `, ${n} risk${n === 1 ? "" : "s"}` : ""}`
        const content = (
          <>
            {cells && n > 0 && <span className={cn("tabular font-semibold", sm ? "text-[12px]" : "text-[14px]")}>{n}</span>}
            {here.map((m) => (
              <span key={m.label} title={m.title}
                className={cn("inline-flex size-5 items-center justify-center rounded-full text-[10.5px] font-semibold",
                  m.solid ? "bg-ink text-card" : "border-2 border-ink bg-card text-ink")}>{m.label}</span>
            ))}
          </>
        )
        const cls = cn("flex items-center justify-center gap-1 rounded-[3px] transition-[filter,opacity]", sm ? "h-8" : "h-12",
          LEVEL_CELL[level], cells && n === 0 && "opacity-45", isSel && "ring-2 ring-petrol ring-offset-1 ring-offset-card")
        return onSelect ? (
          <button key={i} type="button" className={cn(cls, "hover:brightness-95 focus-visible:outline-2 focus-visible:outline-petrol")}
            aria-label={label} title={label} aria-pressed={isSel} onClick={() => onSelect(isSel ? null : { l, i })}>
            {content}
          </button>
        ) : (
          <div key={i} className={cls} title={label} aria-label={label} role="img">{content}</div>
        )
      })}
    </>
  )
}

export function LevelLegend({ method, className }: { method: RiskMethod; className?: string }) {
  const ranges: Record<Level, string> = {
    low: `1–${method.threshold_medium - 1}`,
    medium: `${method.threshold_medium}–${method.threshold_high - 1}`,
    high: `${method.threshold_high}–${method.threshold_very_high - 1}`,
    very_high: `${method.threshold_very_high}–25`,
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3", className)}>
      {LEVELS.map((lv) => (
        <span key={lv} className="inline-flex items-center gap-1.5">
          <span className={cn("size-3 rounded-[2px]", LEVEL_CELL[lv])} />
          {LEVEL_LABEL[lv]} <span className="tabular">{ranges[lv]}</span>
        </span>
      ))}
      <span>Score = likelihood × impact. Appetite up to {LEVEL_LABEL[method.appetite_level].toLowerCase()}.</span>
    </div>
  )
}
