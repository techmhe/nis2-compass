import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { Code, Empty, EntityTag, ErrorState, Loading, Pill, Section, Stat } from "@/components/common/basics"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import type { EntityBrief } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useFlags } from "./assets"
import {
  CoveragePill, CritPill, EntityFilter, fmtHours, ResultPill, TestStatePill, useInventoryMeta, useOpenSheet, useParam,
  type CoverageRow, type ExerciseBrief, type Flag,
} from "./shared"

interface Overview {
  counts: { services: number; critical_services: number; nis2_services: number; assets: number; assets_by_type: Record<string, number>; plans: number; exercises: number }
  coverage: CoverageRow[]
  flags: { high: number; medium: number; low: number; top: Flag[] }
  plans: { id: number; code: string; title: string; plan_type: string; entity: EntityBrief | null; last_tested: string | null; next_test_due: string | null; test_state: string }[]
  upcoming_exercises: (ExerciseBrief & { entity: EntityBrief | null })[]
  recent_exercises: (ExerciseBrief & { entity: EntityBrief | null })[]
  bia: { id: number; entity: EntityBrief | null; period: string; status: string; approved_at: string | null; next_review: string | null }[]
}

const SEVERITY: Record<Flag["severity"], { label: string; tone: string }> = {
  high: { label: "High", tone: "alarm" }, medium: { label: "Medium", tone: "amber" }, low: { label: "Low", tone: "neutral" },
}

function Entity({ e }: { e: EntityBrief | null | undefined }) {
  return e ? <EntityTag code={e.code} name={e.name} /> : <span className="text-[12.5px] text-ink-3">Group</span>
}

export function OverviewTab() {
  const [entity, setEntity] = useParam("entity")
  const meta = useInventoryMeta()
  const openSheet = useOpenSheet()
  const q = useQuery({
    queryKey: ["inv", "overview", entity],
    queryFn: () => api.get<Overview>("/inventory/overview", { entity_id: entity ?? undefined }),
  })
  const flags = useFlags(entity)

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState error={q.error} />
  const d = q.data!
  const covProblems = d.coverage.filter((c) => c.state !== "ok").length
  const allFlags = flags.data ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <EntityFilter value={entity} onChange={setEntity} />
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border bg-card px-5 py-4 md:grid-cols-5">
        <Stat label="Active services" value={d.counts.services} hint={`${d.counts.nis2_services} NIS2 relevant`} />
        <Stat label="High and critical services" value={d.counts.critical_services}
          hint={covProblems ? `${covProblems} without a valid restore test` : "all restore-tested"} tone={covProblems ? "alarm" : undefined} />
        <Stat label="Assets" value={d.counts.assets}
          hint={Object.entries(d.counts.assets_by_type).map(([k, v]) => `${v} ${meta.data?.asset_types[k] ?? k}`).slice(0, 3).join(", ") || "none recorded"} />
        <Stat label="Continuity plans" value={d.counts.plans} hint={`${d.counts.exercises} exercises logged`} />
        <Stat label="Findings" value={d.flags.high + d.flags.medium + d.flags.low} tone={d.flags.high ? "alarm" : d.flags.medium ? "amber" : undefined}
          hint={`${d.flags.high} high, ${d.flags.medium} medium, ${d.flags.low} low`} />
      </div>

      <Section title="Recovery readiness of high and critical services" bodyClassName="p-0">
        {d.coverage.length === 0 ? (
          <Empty title="No high or critical services">Set the criticality of services to see whether their RTO and RPO targets are backed by restore tests.</Empty>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="py-2 pr-2 pl-4 font-medium">Service</th>
                  <th className="px-2 py-2 font-medium">Entity</th>
                  <th className="px-2 py-2 font-medium">Criticality</th>
                  <th className="px-2 py-2 text-right font-medium">RTO target</th>
                  <th className="px-2 py-2 text-right font-medium">RPO target</th>
                  <th className="px-2 py-2 font-medium">Last successful test</th>
                  <th className="px-2 py-2 text-right font-medium">Restored in</th>
                  <th className="px-2 py-2 text-right font-medium">Data loss</th>
                  <th className="px-2 py-2 pr-4 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {[...d.coverage].sort((a, b) => stateRank(a.state) - stateRank(b.state) || b.criticality - a.criticality).map((c) => {
                  const ok = c.last_success
                  const rtoOver = ok && c.rto_hours != null && ok.achieved_rto_hours != null && ok.achieved_rto_hours > c.rto_hours
                  const rpoOver = ok && c.rpo_hours != null && ok.achieved_rpo_hours != null && ok.achieved_rpo_hours > c.rpo_hours
                  return (
                    <tr key={c.service_id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-2 pr-2 pl-4">
                        <button className="flex items-baseline gap-2 text-left hover:text-petrol" onClick={() => openSheet("service", c.service_id)}>
                          <Code>{c.code}</Code><span className="font-medium text-ink">{c.name}</span>
                        </button>
                      </td>
                      <td className="px-2 py-2"><Entity e={c.entity} /></td>
                      <td className="px-2 py-2"><CritPill value={c.criticality} /></td>
                      <td className="tabular px-2 py-2 text-right">{fmtHours(c.rto_hours)}</td>
                      <td className="tabular px-2 py-2 text-right">{fmtHours(c.rpo_hours)}</td>
                      <td className="px-2 py-2">
                        {ok ? (
                          <button className="text-left hover:text-petrol" onClick={() => openSheet("exercise", ok.id)}>
                            <span className="tabular">{fmtDate(ok.date)}</span> <Code className="ml-1">{ok.code}</Code>
                          </button>
                        ) : <span className="text-ink-3">None</span>}
                        {c.last_test && c.last_test.result === "failed" && (
                          <div className="mt-0.5 text-[12px] text-alarm">
                            <button className="hover:underline" onClick={() => openSheet("exercise", c.last_test!.id)}>{c.last_test.code} failed on {fmtDate(c.last_test.date)}</button>
                          </div>
                        )}
                      </td>
                      <td className={cn("tabular px-2 py-2 text-right", rtoOver && "font-medium text-alarm")}>{fmtHours(ok?.achieved_rto_hours)}</td>
                      <td className={cn("tabular px-2 py-2 text-right", rpoOver && "font-medium text-alarm")}>{fmtHours(ok?.achieved_rpo_hours)}</td>
                      <td className="px-2 py-2 pr-4"><CoveragePill state={c.state} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t px-4 py-2 text-[12px] text-ink-3">
          Compares each service's RTO and RPO target with the last passed or partially passed restore or failover test covering the service or one of its assets (IR 2024/2690 point 4.2.6).
        </p>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Consistency checks" bodyClassName="p-0">
          {flags.isLoading ? <Loading /> : allFlags.length === 0 ? (
            <Empty title="No findings" icon={<CheckCircle2 className="size-6 text-sage" />}>Every asset has an owner and classification, and every critical service has an approved BIA and a tested plan.</Empty>
          ) : (
            <ul className="max-h-[440px] divide-y overflow-y-auto scroll-thin">
              {allFlags.map((f, i) => (
                <li key={`${f.code}-${f.object_type}-${f.object_id}-${i}`}>
                  <button className="flex w-full items-start gap-2.5 px-4 py-2 text-left hover:bg-muted/50" onClick={() => openSheet(f.object_type, f.object_id)}>
                    <Pill tone={SEVERITY[f.severity].tone} className="mt-0.5 w-14 justify-center">{SEVERITY[f.severity].label}</Pill>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <Code>{f.object_code}</Code><span className="font-medium text-ink">{f.label}</span>
                      </span>
                      <span className="block text-[12.5px] text-ink-2">{f.message}</span>
                    </span>
                    <Entity e={f.entity} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="space-y-5">
          <Section title="Continuity plans" actions={<Link to="/inventory/plans" className="text-[12.5px] text-petrol hover:underline">Open plans and exercises</Link>} bodyClassName="p-0">
            {d.plans.length === 0 ? <Empty title="No continuity plans">Record the BCP, DRP and crisis plans under Plans and exercises.</Empty> : (
              <ul className="divide-y">
                {d.plans.map((p) => (
                  <li key={p.id}>
                    <button className="flex w-full flex-wrap items-center gap-2 px-4 py-2 text-left text-[13px] hover:bg-muted/50" onClick={() => openSheet("plan", p.id)}>
                      <Code>{p.code}</Code><span className="min-w-0 flex-1 truncate font-medium text-ink">{p.title}</span>
                      <Entity e={p.entity} />
                      <span className="tabular text-[12px] text-ink-3">next test {p.next_test_due ? fmtDate(p.next_test_due) : "not planned"}</span>
                      <TestStatePill state={p.test_state} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Exercises" bodyClassName="p-0">
            {d.upcoming_exercises.length + d.recent_exercises.length === 0 ? (
              <Empty title="No exercises logged">Log tabletop exercises, restore tests and failover tests under Plans and exercises.</Empty>
            ) : (
              <ul className="divide-y">
                {[...d.upcoming_exercises, ...d.recent_exercises].map((e) => (
                  <li key={e.id}>
                    <button className="flex w-full flex-wrap items-center gap-2 px-4 py-2 text-left text-[13px] hover:bg-muted/50" onClick={() => openSheet("exercise", e.id)}>
                      <span className="tabular w-24 shrink-0 text-[12.5px] text-ink-2">{fmtDate(e.exercise_date)}</span>
                      <Code>{e.code}</Code><span className="min-w-0 flex-1 truncate text-ink">{e.title}</span>
                      <Entity e={e.entity} />
                      <ResultPill result={e.result} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Business impact analyses" actions={<Link to="/inventory/bia" className="text-[12.5px] text-petrol hover:underline">Open BIAs</Link>} bodyClassName="p-0">
            {d.bia.length === 0 ? <Empty title="No BIA yet">Start a business impact analysis per entity under BIA.</Empty> : (
              <ul className="divide-y">
                {d.bia.map((b) => (
                  <li key={b.id}>
                    <Link to={`/inventory/bia/${b.id}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[13px] hover:bg-muted/50">
                      <Entity e={b.entity} /><span className="flex-1 text-ink">BIA {b.period}</span>
                      {b.status === "approved" ? <Pill tone="sage">Approved</Pill> : <Pill tone="brass">Draft</Pill>}
                      {b.next_review && <span className="tabular text-[12px] text-ink-3">review {fmtDate(b.next_review)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
      {d.flags.high > 0 && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-ink-3"><AlertTriangle className="size-3.5 text-alarm" />
          High findings concern critical services without an approved BIA, without a tested continuity plan or depending on end-of-life assets.</p>
      )}
    </div>
  )
}

function stateRank(s: string): number {
  return { failed: 0, no_test: 1, exceeds: 2, stale: 3, no_target: 4, ok: 5 }[s] ?? 9
}
