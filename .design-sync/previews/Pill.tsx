import { Code, Pill } from "@nis2-compass/ui"

export function Tones() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill tone="neutral">Neutral</Pill>
      <Pill tone="petrol">Petrol</Pill>
      <Pill tone="brass">Brass</Pill>
      <Pill tone="alarm">Alarm</Pill>
      <Pill tone="amber">Amber</Pill>
      <Pill tone="sage">Sage</Pill>
      <Pill tone="outline">Outline</Pill>
    </div>
  )
}

export function InARow() {
  return (
    <div className="space-y-2 text-[13px]">
      <div className="flex items-center gap-2">
        <Code>AP-005</Code>
        <span className="text-ink-2">Document the procedure and have it approved by the ISO</span>
        <Pill tone="brass">Chapter 1.1</Pill>
        <Pill tone="outline">Manual control</Pill>
      </div>
      <div className="flex items-center gap-2">
        <Code>AP-011</Code>
        <span className="text-ink-2">Plan and perform an effectiveness test; record results</span>
        <Pill tone="amber">Due soon</Pill>
        <Pill tone="neutral">Chapter 2.1</Pill>
      </div>
    </div>
  )
}

export function WithTitle() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill tone="alarm" title="14 days overdue">Overdue</Pill>
      <Pill tone="sage" title="Approved by ISO on 12 Sep 2026">Approved</Pill>
    </div>
  )
}
