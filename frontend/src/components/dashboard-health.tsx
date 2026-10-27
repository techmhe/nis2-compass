import type { ReactNode } from "react"
import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { CalendarCheck, Landmark, ShieldAlert, Siren, Stamp } from "lucide-react"
import { Section } from "@/components/common/basics"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

interface Tile { to: string; icon: ReactNode; title: string; value: number | string; detail: string; alarm?: boolean }

/** One line per programme area: what needs attention now. Each tile only appears with the matching permission. */
export function ProgrammeHealth() {
  const { canAny } = useAuth()
  const risks = useQuery({ queryKey: ["dash-risks"], queryFn: () => api.get<{ total: number; by_level: { residual: Record<string, number> }; entities: { above_appetite: number }[] }>("/risks/heatmap"), enabled: canAny("risks.read") })
  const controls = useQuery({ queryKey: ["dash-controls"], queryFn: () => api.get<{ overdue: number; due_next_30_days: number; not_effective_last_90_days: number }>("/controls/summary"), enabled: canAny("controls.read") })
  const gov = useQuery({ queryKey: ["dash-gov"], queryFn: () => api.get<{ obligations: { overdue: number; due_soon: number }; registration_changes: { pending: number; overdue: number } }>("/governance/overview"), enabled: canAny("governance.read") })
  const deadlines = useQuery({ queryKey: ["dash-deadlines"], queryFn: () => api.get<{ state: string }[]>("/incident-reporting/deadlines", { days: 7 }), enabled: canAny("incidents.read") })
  const approvals = useQuery({ queryKey: ["dash-approvals"], queryFn: () => api.get<{ waiting: number; waiting_overdue: number; requested_pending: number }>("/approvals/summary") })

  const tiles: Tile[] = []
  if (risks.data) {
    const r = risks.data.by_level.residual
    const above = risks.data.entities.reduce((n, e) => n + (e.above_appetite ?? 0), 0)
    tiles.push({ to: "/risks", icon: <ShieldAlert />, title: "Risks", value: (r.high ?? 0) + (r.very_high ?? 0),
      detail: `high or very high residual, ${above} above appetite`, alarm: (r.very_high ?? 0) > 0 })
  }
  if (controls.data) tiles.push({ to: "/controls/calendar", icon: <CalendarCheck />, title: "Controls", value: controls.data.overdue,
    detail: `overdue, ${controls.data.due_next_30_days} due in 30 days`, alarm: controls.data.overdue > 0 })
  if (gov.data) tiles.push({ to: "/governance/obligations", icon: <Landmark />, title: "Obligations", value: gov.data.obligations.overdue,
    detail: `overdue${gov.data.registration_changes.pending ? `, ${gov.data.registration_changes.pending} registration ${gov.data.registration_changes.pending === 1 ? "change" : "changes"} to report` : ""}`,
    alarm: gov.data.obligations.overdue > 0 || gov.data.registration_changes.overdue > 0 })
  if (deadlines.data) {
    const overdue = deadlines.data.filter((d) => d.state === "overdue").length
    tiles.push({ to: "/incidents", icon: <Siren />, title: "Incident reports", value: deadlines.data.length,
      detail: overdue ? `due within 7 days, ${overdue} overdue` : "due within 7 days", alarm: overdue > 0 })
  }
  if (approvals.data) tiles.push({ to: "/approvals", icon: <Stamp />, title: "Approvals", value: approvals.data.waiting,
    detail: `waiting for you, ${approvals.data.requested_pending} requested by you`, alarm: approvals.data.waiting_overdue > 0 })
  if (!tiles.length) return null

  return (
    <Section title="Programme health" bodyClassName="p-0">
      <ul className="grid divide-y sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5">
        {tiles.map((t) => (
          <li key={t.title} className="sm:border-r sm:last:border-r-0">
            <Link to={t.to} className="flex h-full flex-col gap-1 px-4 py-3 hover:bg-muted/50">
              <span className="flex items-center gap-1.5 text-[12.5px] text-ink-3 [&_svg]:size-3.5">{t.icon}{t.title}</span>
              <span className={cn("tabular text-[22px] leading-tight font-semibold", t.alarm ? "text-alarm" : "text-ink")}>{t.value}</span>
              <span className="text-[12px] text-ink-3">{t.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  )
}
