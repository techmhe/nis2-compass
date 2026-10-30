import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts"
import { Download } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Code, Empty, ErrorState, Loading, Meter, PageHeader, ScoreBar, Section, Stat, StatusPill } from "@/components/common/basics"
import { OptionSelect } from "@/components/common/fields"
import { BindingGapsTile } from "@/components/governance/legal"
import { useAuth } from "@/hooks/useAuth"
import { useRounds } from "@/hooks/useRefData"
import { api, download } from "@/lib/api"
import { fmtDate, pct, scoreColor } from "@/lib/format"
import type { AssessmentStats } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ProgrammeHealth } from "@/components/dashboard-health"
import { useTourAutoStart } from "@/tour/TourProvider"

interface GapDashboard {
  round_id: number
  entities: ({ assessment_id: number; entity: { id: number; code: string; name: string }; status: string } & AssessmentStats)[]
  totals: { in_scope: number; assessed: number; work_packages: number; no_answers: number; not_tested: number; average_score: number | null; coverage: number | null }
  chapters: { chapter: number; title: string; target: number; entities: Record<string, number | null>; work_packages: number; group_average: number | null; gap_to_target: number | null }[]
  action_plan: { total: number; by_priority: Record<string, number>; by_status: Record<string, number>; overdue: number; due_soon: number; unplanned_findings: number }
  requirements_per_entity: number
}

interface Home {
  project?: {
    id: number; name: string; planned_finish: string | null
    activities: { total: number; completed: number; overall_progress: number; red: number; amber: number; finishing_next_30_days: number }
    raid: { open_risks: number; open_issues: number; high_severity_open: number; escalations: number }
    work_packages: { total: number; high_priority_open: number; overdue: number }
    phases: { phase: string; activities: number; completed: number; progress: number; overdue: number }[]
    next_gate: { id: number; code: string; planned_date: string | null; decision: string | null } | null
    upcoming: { id: number; code: string; title: string; planned_finish: string; status: string }[]
  }
  my_tasks: { open: number; overdue: number }
  documents?: { total: number; review_due: number }
  incidents?: { open: number }
  action_items_overdue?: number
}

function daysUntil(d: string | null | undefined) {
  if (!d) return null
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000)
}

/** The signature element: chapters × entities, coloured by score, with the chapter target. */
function ComplianceMatrix({ data }: { data: GapDashboard }) {
  const navigate = useNavigate()
  const entities = data.entities
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="text-left text-[12px] text-ink-3">
            <th className="sticky left-0 z-10 min-w-[250px] bg-card pb-2 pr-3 font-medium">Chapter</th>
            {entities.map((e) => (
              <th key={e.entity.code} className="w-[74px] pb-2 text-center font-medium">
                <Link to={`/assessments/${e.assessment_id}`} className="font-mono text-[12px] text-ink-2 hover:text-petrol" title={e.entity.name}>{e.entity.code}</Link>
              </th>
            ))}
            <th className="w-[74px] pb-2 text-center font-medium">Group</th>
            <th className="w-[150px] pb-2 pl-4 font-medium">Group vs. target</th>
            <th className="w-[60px] pb-2 text-right font-medium">Findings</th>
          </tr>
        </thead>
        <tbody>
          {data.chapters.map((c) => (
            <tr key={c.chapter} className="group">
              <td className="sticky left-0 z-10 border-t bg-card py-1 pr-3">
                <Link to={`/catalog?chapter=${c.chapter}`} className="flex items-baseline gap-2 hover:text-petrol">
                  <Code className="w-5 text-right text-ink-3">{c.chapter}</Code>
                  <span className="line-clamp-1" title={c.title}>{c.title}</span>
                </Link>
              </td>
              {entities.map((e) => {
                const v = c.entities[e.entity.code]
                return (
                  <td key={e.entity.code} className="border-t p-[3px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => navigate(`/assessments/${e.assessment_id}?chapter=${c.chapter}`)}
                          className={cn("tabular flex h-7 w-full items-center justify-center rounded-[3px] text-[12px] font-medium transition-[filter] hover:brightness-110",
                            v == null ? "bg-muted text-ink-3" : "text-white")}
                          style={v != null ? { background: scoreColor(v) } : undefined}
                        >
                          {v == null ? "–" : pct(v)}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{e.entity.name} · Chapter {c.chapter}: {v == null ? "not assessed" : pct(v)} (target {pct(c.target)})</TooltipContent>
                    </Tooltip>
                  </td>
                )
              })}
              <td className="border-t p-[3px]">
                <div className="tabular flex h-7 items-center justify-center rounded-[3px] border text-[12px] font-semibold"
                  style={{ borderColor: c.group_average != null ? scoreColor(c.group_average) : undefined }}>
                  {pct(c.group_average)}
                </div>
              </td>
              <td className="border-t py-1 pl-4">
                <ScoreBar value={c.group_average} target={c.target} showLabel={false} />
              </td>
              <td className="tabular border-t py-1 text-right text-ink-2">{c.work_packages || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5">Score
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => <span key={v} className="size-3 rounded-[2px]" style={{ background: scoreColor(v) }} />)}
          0 → 100%
        </span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-[2px] bg-brass" /> chapter target</span>
        <span>Click a cell to open that chapter in the entity's assessment.</span>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { canAny, can, me } = useAuth()
  const rounds = useRounds()
  const [roundId, setRoundId] = useState<number | null>(null)
  const current = roundId ?? rounds.data?.find((r) => r.is_current)?.id ?? null
  const gap = useQuery({
    queryKey: ["dash-gap", current],
    queryFn: () => api.get<GapDashboard>("/dashboard/gap", { round_id: current }),
    enabled: canAny("assessments.read") && current != null,
  })
  const home = useQuery({ queryKey: ["dash-home"], queryFn: () => api.get<Home>("/dashboard/home") })
  useTourAutoStart(!rounds.isLoading && !gap.isLoading && !home.isLoading)

  const gapRanking = useMemo(
    () => (gap.data?.chapters ?? []).filter((c) => c.gap_to_target != null && c.gap_to_target > 0)
      .sort((a, b) => (b.gap_to_target ?? 0) - (a.gap_to_target ?? 0)).slice(0, 8)
      .map((c) => ({ name: `${c.chapter}`, title: c.title, gap: Math.round((c.gap_to_target ?? 0) * 100) })),
    [gap.data],
  )
  const dist = useMemo(
    () => (gap.data?.entities ?? []).map((e) => ({ name: e.entity.code, ...e.answer_distribution })),
    [gap.data],
  )

  const p = home.data?.project
  const gateDays = daysUntil(p?.next_gate?.planned_date)

  return (
    <div>
      <div data-tour="welcome.dashboard">
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${me?.display_name.split(" ")[0] ?? ""}`}
        description="Group-wide NIS-2 status: assessment coverage and scores per entity, remediation and project progress."
        actions={canAny("assessments.read") && (
          <>
            <div className="w-72">
              <OptionSelect value={current ? String(current) : null} onChange={(v) => setRoundId(v ? Number(v) : null)}
                options={(rounds.data ?? []).map((r) => ({ value: String(r.id), label: r.name + (r.is_current ? " (current)" : "") }))} />
            </div>
            {can("reports.export") && (
              <Button variant="outline" onClick={() => download(`/export/gap-workbook?round_id=${current}`, "NIS2_GAP_Analysis.xlsx").catch((e) => toast.error(e.message))}>
                <Download /> Export workbook
              </Button>
            )}
          </>
        )}
      />
      </div>

      {gap.data && (
        <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border bg-card px-5 py-4 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Assessment coverage" value={pct(gap.data.totals.coverage)} hint={`${gap.data.totals.assessed} of ${gap.data.totals.in_scope} in-scope answers`} />
          <Stat label="Group average score" value={pct(gap.data.totals.average_score)} hint="Target 75% (chapters 14–16: 100%)" tone="petrol" />
          <Stat label="Findings" value={gap.data.totals.work_packages} hint={`${gap.data.action_plan.unplanned_findings} not yet in the action plan`} tone={gap.data.action_plan.unplanned_findings ? "amber" : undefined} />
          <Stat label="Action plan" value={gap.data.action_plan.total} hint={`${gap.data.action_plan.by_status["Completed"] ?? 0} completed, ${gap.data.action_plan.overdue} overdue`} tone={gap.data.action_plan.overdue ? "alarm" : undefined} />
          {p?.next_gate ? (
            <Stat label={`Next gate: ${p.next_gate.code}`} value={gateDays != null ? (gateDays >= 0 ? `${gateDays} days` : `${-gateDays} days late`) : "–"} hint={fmtDate(p.next_gate.planned_date)} tone={gateDays != null && gateDays < 0 ? "alarm" : undefined} />
          ) : <Stat label="Next gate" value="–" />}
          <Stat label="My open tasks" value={home.data?.my_tasks.open ?? "–"} hint={home.data?.my_tasks.overdue ? `${home.data.my_tasks.overdue} overdue` : "none overdue"} tone={home.data?.my_tasks.overdue ? "alarm" : undefined} />
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <div data-tour="programme.matrix">
            <Section title="Compliance matrix" actions={<Link to="/assessments" className="text-[12.5px] text-petrol hover:underline">All assessments</Link>}>
              {gap.isLoading ? <Loading /> : gap.error ? <ErrorState error={gap.error} /> : gap.data ? <ComplianceMatrix data={gap.data} /> : <Empty title="No assessment data you can see" />}
            </Section>
          </div>
          <ProgrammeHealth />
        </div>

        <div className="space-y-5">
          {gap.data && (
            <Section title="Entities">
              <ul className="space-y-3">
                {gap.data.entities.map((e) => (
                  <li key={e.entity.code}>
                    <Link to={`/assessments/${e.assessment_id}`} className="block rounded-md p-1 -m-1 hover:bg-muted/60">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13.5px] font-medium">{e.entity.name} <Code className="text-ink-3">{e.entity.code}</Code></span>
                        <StatusPill value={e.status} />
                      </div>
                      <div className="mt-1.5 grid grid-cols-[1fr_auto] items-center gap-x-3 text-[12px] text-ink-3">
                        <Meter value={e.coverage ?? 0} />
                        <span className="tabular w-[120px] text-right whitespace-nowrap">{e.assessed}/{e.in_scope} assessed</span>
                      </div>
                      <div className="mt-1 flex justify-between text-[12px] text-ink-3">
                        <span>Average score <span className="tabular font-medium text-ink">{pct(e.average_score)}</span></span>
                        <span><span className="tabular font-medium text-ink">{e.work_packages}</span> findings</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <BindingGapsTile />

          {p && (
            <Section title={p.name} actions={<Link to={`/projects/${p.id}`} className="text-[12.5px] text-petrol hover:underline">Open</Link>}>
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-[13px] text-ink-3">Overall progress</span>
                <span className="tabular text-[18px] font-semibold">{pct(p.activities.overall_progress)}</span>
              </div>
              <ul className="space-y-2">
                {p.phases.map((ph) => (
                  <li key={ph.phase} className="grid grid-cols-[1fr_90px_36px] items-center gap-2 text-[12.5px]">
                    <span className="truncate text-ink-2">{ph.phase}</span>
                    <Meter value={ph.progress} tone={ph.overdue ? "alarm" : "petrol"} />
                    <span className="tabular text-right text-ink-3">{ph.completed}/{ph.activities}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-3">
                <Stat label="Overdue" value={p.activities.red} tone={p.activities.red ? "alarm" : undefined} />
                <Stat label="Open risks" value={p.raid.open_risks} />
                <Stat label="Escalations" value={p.raid.escalations} tone={p.raid.escalations ? "alarm" : undefined} />
              </div>
            </Section>
          )}
        </div>
      </div>

      {gap.data && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div data-tour="programme.gaps">
            <Section title="Largest gaps to target" className="h-full">
              {gapRanking.length === 0 ? <Empty title="No chapter below target" /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={gapRanking} layout="vertical" margin={{ left: 4, right: 16 }}>
                    <CartesianGrid horizontal={false} stroke="var(--line)" />
                    <XAxis type="number" unit="%" tick={{ fontSize: 12, fill: "var(--ink-3)" }} stroke="var(--line)" />
                    <YAxis type="category" dataKey="name" width={28} tick={{ fontSize: 12, fill: "var(--ink-2)", fontFamily: "IBM Plex Mono" }} stroke="var(--line)" />
                    <RTooltip cursor={{ fill: "var(--muted)" }} contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)" }}
                      formatter={(v) => [`${v} percentage points`, "Gap"]} labelFormatter={(l) => gapRanking.find((g) => g.name === l)?.title ?? l} />
                    <Bar dataKey="gap" fill="var(--alarm)" radius={[0, 3, 3, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Section>
          </div>
          <Section title="Answer distribution (Implemented)">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dist} margin={{ left: -12, right: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--ink-2)", fontFamily: "IBM Plex Mono" }} stroke="var(--line)" />
                <YAxis tick={{ fontSize: 12, fill: "var(--ink-3)" }} stroke="var(--line)" />
                <RTooltip cursor={{ fill: "var(--muted)" }} contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)" }} />
                <Bar dataKey="Yes" stackId="a" fill="var(--score-5)" />
                <Bar dataKey="Partial" stackId="a" fill="var(--score-2)" />
                <Bar dataKey="No" stackId="a" fill="var(--score-0)" />
                <Bar dataKey="Not assessed" stackId="a" fill="var(--line-strong)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Section>
        </div>
      )}

      {p && p.upcoming.length > 0 && (
        <Section title="Due in the next 30 days" className="mt-5" bodyClassName="p-0">
          <ul>
            {p.upcoming.map((a) => (
              <li key={a.id} className="flex items-center gap-3 border-b px-4 py-2 last:border-0">
                <Code className="w-10">{a.code}</Code>
                <Link to={`/projects/${p.id}/plan?activity=${a.id}`} className="min-w-0 flex-1 truncate text-[13px] hover:text-petrol">{a.title}</Link>
                <StatusPill value={a.status} />
                <span className="tabular w-24 text-right text-[12.5px] text-ink-3">{fmtDate(a.planned_finish)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
