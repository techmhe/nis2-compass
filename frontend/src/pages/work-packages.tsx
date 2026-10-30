import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import { Columns3, List, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Code, Empty, EntityTag, ErrorState, Loading, Meter, PageHeader, PriorityPill, Stat, StatusPill } from "@/components/common/basics"
import { UserAvatar } from "@/components/common/collab"
import { OptionSelect, UserSelect } from "@/components/common/fields"
import { ScheduleDot } from "@/components/project/shared"
import { NewWorkPackageDialog } from "@/components/project/wp-shared"
import { useWorkPackageOptions } from "@/components/tasks/common"
import { useAuth } from "@/hooks/useAuth"
import { useEntities } from "@/hooks/useRefData"
import { MEASURE_AREAS, PRIORITY_VALUES, PROJECT_STATUS } from "@/lib/constants"
import { fmtDate, pct } from "@/lib/format"
import type { WorkPackage } from "@/lib/types"
import { cn } from "@/lib/utils"

const BOARD_COLUMNS = ["Not Started", "In Progress", "Blocked", "Completed", "Deferred", "Cancelled"]

export default function WorkPackagesPage() {
  const { canAny } = useAuth()
  const navigate = useNavigate()
  const q = useWorkPackageOptions()
  const entities = useEntities()
  const [view, setView] = useState<"table" | "board">(() => {
    try { return localStorage.getItem("wp-view") === "board" ? "board" : "table" } catch { return "table" }
  })
  const [creating, setCreating] = useState(false)
  const [text, setText] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [priority, setPriority] = useState<string | null>(null)
  const [entity, setEntity] = useState<string | null>(null)
  const [area, setArea] = useState<string | null>(null)
  const [owner, setOwner] = useState<number | null>(null)
  const changeView = (v: "table" | "board") => { setView(v); try { localStorage.setItem("wp-view", v) } catch { /* ignore */ } }

  const rows = useMemo(() => {
    const t = text.trim().toLowerCase()
    return (q.data ?? []).filter((w) => (!status || w.status === status) && (!priority || w.priority === priority)
      && (!entity || (entity === "group" ? !w.entity : String(w.entity?.id) === entity || w.findings.some((f) => f.entity_code === entities.data?.find((e) => String(e.id) === entity)?.code)))
      && (!area || w.measure_area === area) && (!owner || w.owner?.id === owner)
      && (!t || `${w.code} ${w.title} ${w.description ?? ""} ${w.findings.map((f) => `${f.code} ${f.requirement}`).join(" ")}`.toLowerCase().includes(t)))
  }, [q.data, text, status, priority, entity, area, owner, entities.data])

  const stats = useMemo(() => {
    const all = q.data ?? []
    const open = all.filter((w) => !["Completed", "Cancelled"].includes(w.status))
    return {
      total: all.length,
      inProgress: all.filter((w) => w.status === "In Progress").length,
      highOpen: open.filter((w) => w.priority === "High").length,
      overdue: open.filter((w) => w.schedule_status === "Red").length,
      blocked: all.filter((w) => w.status === "Blocked").length,
      progress: all.length ? all.reduce((s, w) => s + w.progress, 0) / all.length : 0,
      findings: new Set(all.flatMap((w) => w.findings.map((f) => f.id))).size,
    }
  }, [q.data])

  const filtersActive = !!(text || status || priority || entity || area || owner)
  const canCreate = canAny("workpackages.manage")

  if (!canAny("workpackages.read")) return <ErrorState error="You do not have permission to view work packages." />

  return (
    <div>
      <PageHeader title="Work packages" description="Remediation measures that bundle findings from the action plan, across one or several entities."
        actions={
          <>
            <div role="tablist" aria-label="View" data-tour="project.work-packages" className="inline-flex rounded-md border bg-surface p-0.5">
              {([["table", "Table", <List key="t" />], ["board", "Board", <Columns3 key="b" />]] as const).map(([v, label, icon]) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => changeView(v)}
                  className={cn("inline-flex h-7 items-center gap-1.5 rounded-[4px] px-2.5 text-[12.5px] font-medium [&_svg]:size-3.5", view === v ? "bg-petrol text-white" : "text-ink-2 hover:bg-muted")}>
                  {icon}{label}
                </button>
              ))}
            </div>
            {canCreate && <Button onClick={() => setCreating(true)}><Plus /> New work package</Button>}
          </>
        } />

      {q.data && q.data.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border bg-card px-5 py-4 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Work packages" value={stats.total} hint={`${stats.findings} findings bundled`} />
          <Stat label="In progress" value={stats.inProgress} tone="petrol" />
          <Stat label="Average progress" value={pct(stats.progress)} />
          <Stat label="High priority open" value={stats.highOpen} tone={stats.highOpen ? "amber" : undefined} />
          <Stat label="Overdue" value={stats.overdue} tone={stats.overdue ? "alarm" : undefined} hint="past planned finish" />
          <Stat label="Blocked" value={stats.blocked} tone={stats.blocked ? "alarm" : undefined} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-60">
          <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search code, title or finding" className="pl-8" aria-label="Search work packages" />
        </div>
        <OptionSelect className="w-40" value={status} onChange={setStatus} options={PROJECT_STATUS} allowNone noneLabel="All statuses" placeholder="Status" />
        <OptionSelect className="w-36" value={priority} onChange={setPriority} options={PRIORITY_VALUES} allowNone noneLabel="Any priority" placeholder="Priority" />
        <OptionSelect className="w-48" value={entity} onChange={setEntity} allowNone noneLabel="Any entity" placeholder="Entity"
          options={[{ value: "group", label: "Group-wide only" }, ...(entities.data ?? []).map((e) => ({ value: String(e.id), label: `${e.code} ${e.name}` }))]} />
        <OptionSelect className="w-56" value={area} onChange={setArea} options={MEASURE_AREAS} allowNone noneLabel="Any measure area" placeholder="Measure area" />
        <div className="w-48"><UserSelect value={owner} onChange={setOwner} placeholder="Any owner" /></div>
        {filtersActive && <Button size="sm" variant="ghost" onClick={() => { setText(""); setStatus(null); setPriority(null); setEntity(null); setArea(null); setOwner(null) }}>Clear filters</Button>}
        <span className="ml-auto text-[12.5px] text-ink-3 tabular">{rows.length} of {q.data?.length ?? 0}</span>
      </div>

      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : rows.length === 0 ? (
        <div className="rounded-md border bg-card">
          <Empty title={filtersActive ? "No work packages match the filters" : "No work packages yet"}
            action={!filtersActive && canCreate && <Button onClick={() => setCreating(true)}><Plus /> New work package</Button>}>
            {filtersActive ? "Clear or change the filters to see more work packages." : "Create a work package and bundle findings from the action plan into it."}
          </Empty>
        </div>
      ) : view === "table" ? (
        <div className="overflow-x-auto rounded-md border bg-card scroll-thin">
          <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-3 [&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th className="w-[72px]">Code</th>
                <th className="min-w-[280px]">Work package</th>
                <th className="w-[92px]">Entities</th>
                <th className="w-[170px]">Measure area</th>
                <th className="w-[84px]">Priority</th>
                <th className="w-[160px]">Owner</th>
                <th className="w-[100px]">Finish</th>
                <th className="w-[140px]">Progress</th>
                <th className="w-[110px]">Status</th>
                <th className="w-[120px]">Schedule</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="cursor-pointer align-top hover:bg-muted/40 [&>td]:border-b [&>td]:px-3 [&>td]:py-2.5" onClick={() => navigate(`/work-packages/${w.id}`)}>
                  <td><Link to={`/work-packages/${w.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-petrol"><Code>{w.code}</Code></Link></td>
                  <td>
                    <div className="text-ink">{w.title}</div>
                    <div className="mt-0.5 text-[12px] text-ink-3">
                      {w.central_or_local} measure, {w.findings.length} finding{w.findings.length === 1 ? "" : "s"}, {w.task_stats.total} task{w.task_stats.total === 1 ? "" : "s"}
                    </div>
                  </td>
                  <td><EntityCell wp={w} /></td>
                  <td className="text-ink-2">{w.measure_area ?? <span className="text-ink-3">–</span>}</td>
                  <td><PriorityPill value={w.priority} /></td>
                  <td>{w.owner ? <span className="inline-flex items-center gap-1.5 text-ink-2"><UserAvatar name={w.owner.display_name} className="size-5" />{w.owner.display_name}</span> : <span className="text-ink-3">{w.owner_stakeholder?.name ?? "–"}</span>}</td>
                  <td className="tabular text-ink-2">{fmtDate(w.planned_finish)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Meter value={w.progress} className="flex-1" />
                      <span className="tabular w-9 text-right text-[12px] text-ink-2">{pct(w.progress)}</span>
                    </div>
                  </td>
                  <td><StatusPill value={w.status} /></td>
                  <td><ScheduleDot value={w.schedule_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 scroll-thin">
          {BOARD_COLUMNS.filter((c) => !["Deferred", "Cancelled"].includes(c) || rows.some((w) => w.status === c)).map((c) => {
            const items = rows.filter((w) => w.status === c)
            return (
              <section key={c} aria-label={c} className="flex max-h-[calc(100vh-330px)] min-h-[260px] flex-col rounded-md border bg-muted/50">
                <header className="flex items-center gap-2 px-3 pt-2.5 pb-2">
                  <StatusPill value={c} />
                  <span className="tabular text-[12px] text-ink-3">{items.length}</span>
                </header>
                <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 scroll-thin">
                  {items.length === 0 && <div className="rounded-md border border-dashed px-3 py-6 text-center text-[12.5px] text-ink-3">None</div>}
                  {items.map((w) => (
                    <Link key={w.id} to={`/work-packages/${w.id}`} className="block rounded-md border bg-card p-3 hover:border-input">
                      <div className="flex items-center gap-2">
                        <Code className="text-[12px]">{w.code}</Code>
                        <EntityCell wp={w} />
                        <span className="ml-auto"><PriorityPill value={w.priority} /></span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink">{w.title}</div>
                      <div className="mt-2 flex items-center gap-2">
                        <Meter value={w.progress} className="flex-1" />
                        <span className="tabular text-[12px] text-ink-2">{pct(w.progress)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[12px] text-ink-3">
                        <span>{w.owner?.display_name ?? w.owner_stakeholder?.name ?? "No owner"}</span>
                        <span className={cn("tabular", w.schedule_status === "Red" && "font-medium text-alarm")}>{fmtDate(w.planned_finish)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {canCreate && <NewWorkPackageDialog open={creating} onOpenChange={setCreating} />}
    </div>
  )
}

function EntityCell({ wp }: { wp: WorkPackage }) {
  if (wp.entity) return <EntityTag code={wp.entity.code} name={wp.entity.name} />
  const codes = [...new Set(wp.findings.map((f) => f.entity_code))]
  if (codes.length === 0) return <span className="text-[12px] text-ink-3">Group</span>
  return (
    <span className="flex flex-wrap gap-1" title="Group-wide work package covering findings of these entities">
      {codes.slice(0, 3).map((c) => <EntityTag key={c} code={c} />)}
      {codes.length > 3 && <span className="text-[11.5px] text-ink-3">+{codes.length - 3}</span>}
    </span>
  )
}
