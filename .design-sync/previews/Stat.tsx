import { Stat } from "@nis2-compass/ui"

export function DashboardKpiRow() {
  return (
    <div className="grid w-[560px] grid-cols-3 gap-x-6 gap-y-4 rounded-md border bg-card px-5 py-4">
      <Stat label="Assessment coverage" value="71%" hint="612 of 862 in-scope answers" />
      <Stat label="Group average score" value="63%" hint="Target 75% (chapters 14–16: 100%)" tone="petrol" />
      <Stat label="Findings" value={34} hint="6 not yet in the action plan" tone="amber" />
      <Stat label="Action plan" value={128} hint="79 completed, 11 overdue" tone="alarm" />
      <Stat label="Next gate: G2" value="12 days" hint="8 Oct 2026" />
      <Stat label="My open tasks" value={9} hint="2 overdue" tone="alarm" />
    </div>
  )
}

export function IncidentKpiRow() {
  return (
    <div className="grid w-[480px] grid-cols-2 gap-x-6 gap-y-4 rounded-md border bg-card px-5 py-4">
      <Stat label="Open incidents" value={5} hint="Open or contained" />
      <Stat label="Significant and open" value={2} tone="alarm" hint="Reportable under Art. 23 NIS2" />
      <Stat label="Reports overdue" value={1} tone="alarm" hint="Early warning, notification or final report" />
      <Stat label="Reports due within 24 h" value={2} tone="amber" />
    </div>
  )
}

export function SingleNoTone() {
  return <Stat label="Documents" value={214} hint="12 pending review" />
}
