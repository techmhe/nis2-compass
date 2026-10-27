import { ScoreBar } from "@nis2-compass/ui"

export function Scale() {
  return (
    <div className="w-64 space-y-2">
      <ScoreBar value={0.12} />
      <ScoreBar value={0.35} />
      <ScoreBar value={0.6} />
      <ScoreBar value={0.82} />
      <ScoreBar value={1} />
    </div>
  )
}

export function WithTarget() {
  return (
    <div className="w-64 space-y-2">
      <ScoreBar value={0.59} target={0.75} />
      <ScoreBar value={0.82} target={0.75} />
      <ScoreBar value={1} target={1} />
    </div>
  )
}

export function NoLabel() {
  return (
    <div className="w-64 space-y-2">
      <ScoreBar value={0.66} target={0.75} showLabel={false} />
      <ScoreBar value={0.41} target={0.75} showLabel={false} />
    </div>
  )
}

export function ChapterTargets() {
  const rows = [
    { chapter: "1 Policy on the security of network and information systems", value: 0.59, target: 0.75 },
    { chapter: "8 Access control", value: 0.71, target: 0.75 },
    { chapter: "14 Human resources security", value: 0.82, target: 1 },
  ]
  return (
    <div className="w-80 space-y-3">
      {rows.map((r) => (
        <div key={r.chapter}>
          <div className="mb-1 text-[12.5px] text-ink-2">{r.chapter}</div>
          <ScoreBar value={r.value} target={r.target} />
        </div>
      ))}
    </div>
  )
}
