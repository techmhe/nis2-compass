import { Meter } from "@nis2-compass/ui"

export function Tones() {
  return (
    <div className="w-64 space-y-3">
      <div>
        <div className="mb-1 text-[12.5px] text-ink-2">Assessment coverage — 71%</div>
        <Meter value={0.71} tone="petrol" />
      </div>
      <div>
        <div className="mb-1 text-[12.5px] text-ink-2">Overdue actions — 34%</div>
        <Meter value={0.34} tone="alarm" />
      </div>
      <div>
        <div className="mb-1 text-[12.5px] text-ink-2">Documents pending review — 52%</div>
        <Meter value={0.52} tone="brass" />
      </div>
    </div>
  )
}

export function InAssessmentRow() {
  const rows = [
    { entity: "ATL", coverage: 0.9 },
    { entity: "ATN", coverage: 0.42 },
    { entity: "ATS", coverage: 0.18 },
  ]
  return (
    <div className="w-72 space-y-2">
      {rows.map((r) => (
        <div key={r.entity} className="flex items-center gap-3">
          <span className="w-10 shrink-0 font-mono text-[11.5px] text-ink-2">{r.entity}</span>
          <Meter value={r.coverage} className="flex-1" />
          <span className="tabular w-9 shrink-0 text-right text-[12.5px] text-ink-2">{Math.round(r.coverage * 100)}%</span>
        </div>
      ))}
    </div>
  )
}

export function Extremes() {
  return (
    <div className="w-64 space-y-3">
      <Meter value={0} />
      <Meter value={1} tone="petrol" />
    </div>
  )
}
