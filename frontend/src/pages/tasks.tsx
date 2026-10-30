import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { addDays, parseISO } from "date-fns"
import { Columns3, List, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Empty, ErrorState, Loading, PageHeader } from "@/components/common/basics"
import { Combo, EntitySelect, OptionSelect, UserSelect } from "@/components/common/fields"
import { useTaskParam, useWorkPackageOptions } from "@/components/tasks/common"
import { KanbanBoard } from "@/components/tasks/kanban"
import { NewTaskDialog } from "@/components/tasks/new-task-dialog"
import { TaskDrawer } from "@/components/tasks/task-drawer"
import { TaskTable } from "@/components/tasks/task-table"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { PRIORITY_VALUES } from "@/lib/constants"
import type { Task } from "@/lib/types"
import { cn } from "@/lib/utils"

type View = "board" | "list"
type Scope = "mine" | "all"

function load<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}
function store(key: string, v: string) {
  try { localStorage.setItem(key, v) } catch { /* ignore */ }
}

export default function TasksPage() {
  const { me, canAny } = useAuth()
  const [, openTask] = useTaskParam()
  const wps = useWorkPackageOptions()
  const [view, setViewState] = useState<View>(() => load("tasks-view", ["board", "list"], "board"))
  const [scope, setScopeState] = useState<Scope>(() => load("tasks-scope", ["mine", "all"], canAny("tasks.read") ? "all" : "mine"))
  const [assignee, setAssignee] = useState<number | null>(null)
  const [wp, setWp] = useState<number | null>(null)
  const [entity, setEntity] = useState<number | null>(null)
  const [priority, setPriority] = useState<string | null>(null)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [hideDone, setHideDone] = useState(false)
  const [text, setText] = useState("")
  const setView = (v: View) => { setViewState(v); store("tasks-view", v) }
  const setScope = (v: Scope) => { setScopeState(v); store("tasks-scope", v) }

  const params = { mine: scope === "mine" ? true : undefined, assignee_id: scope === "all" ? assignee ?? undefined : undefined, work_package_id: wp ?? undefined, entity_id: entity ?? undefined }
  const q = useQuery({ queryKey: ["tasks", params], queryFn: () => api.get<Task[]>("/tasks", params) })

  const tasks = useMemo(() => {
    const t = text.trim().toLowerCase()
    return (q.data ?? []).filter((x) => (!priority || x.priority === priority) && (!overdueOnly || x.overdue) && (!hideDone || view === "board" || x.status !== "done")
      && (!t || `${x.key} ${x.title} ${x.description ?? ""} ${x.labels.join(" ")} ${x.work_package?.code ?? ""}`.toLowerCase().includes(t)))
  }, [q.data, priority, overdueOnly, hideDone, text, view])

  const stats = useMemo(() => {
    const all = q.data ?? []
    const open = all.filter((t) => t.status !== "done")
    const soon = addDays(new Date(), 7)
    return {
      open: open.length,
      overdue: open.filter((t) => t.overdue).length,
      week: open.filter((t) => t.due_date && !t.overdue && parseISO(t.due_date) <= soon).length,
      blocked: open.filter((t) => t.status === "blocked").length,
      done: all.length - open.length,
    }
  }, [q.data])

  const filtersActive = !!(assignee || wp || entity || priority || overdueOnly || text)
  const clear = () => { setAssignee(null); setWp(null); setEntity(null); setPriority(null); setOverdueOnly(false); setText("") }

  return (
    <div>
      <PageHeader title="Tasks" description="Plan and track the work behind work packages, findings and assessment answers."
        actions={
          <>
            <div role="tablist" aria-label="View" data-tour="project.tasks" className="inline-flex rounded-md border bg-surface p-0.5">
              {([["board", "Board", <Columns3 key="b" />], ["list", "List", <List key="l" />]] as const).map(([v, label, icon]) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                  className={cn("inline-flex h-7 items-center gap-1.5 rounded-[4px] px-2.5 text-[12.5px] font-medium [&_svg]:size-3.5", view === v ? "bg-petrol text-white" : "text-ink-2 hover:bg-muted")}>
                  {icon}{label}
                </button>
              ))}
            </div>
            <NewTaskDialog trigger={<Button><Plus /> New task</Button>} onCreated={(t) => openTask(t.id)} />
          </>
        } />

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-card px-4 py-2.5 text-[13px]">
        <span className="text-ink-2"><span className="tabular font-semibold text-ink">{stats.open}</span> open</span>
        <span className={cn(stats.overdue ? "text-alarm" : "text-ink-2")}><span className="tabular font-semibold">{stats.overdue}</span> overdue</span>
        <span className="text-ink-2"><span className="tabular font-semibold text-ink">{stats.week}</span> due in the next 7 days</span>
        <span className={cn(stats.blocked ? "text-alarm" : "text-ink-2")}><span className="tabular font-semibold">{stats.blocked}</span> blocked</span>
        <span className="text-ink-2"><span className="tabular font-semibold text-ink">{stats.done}</span> done</span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Scope" className="inline-flex rounded-md border bg-surface p-0.5">
          {([["mine", "Assigned to me"], ["all", "All tasks"]] as const).map(([v, label]) => (
            <button key={v} role="tab" aria-selected={scope === v} onClick={() => setScope(v)}
              className={cn("h-7 rounded-[4px] px-2.5 text-[12.5px] font-medium", scope === v ? "bg-muted text-ink" : "text-ink-3 hover:text-ink")}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative w-56">
          <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search tasks" className="pl-8" aria-label="Search tasks" />
        </div>
        {scope === "all" && <div className="w-48"><UserSelect value={assignee} onChange={setAssignee} placeholder="Any assignee" /></div>}
        {canAny("workpackages.read") && (
          <div className="w-52">
            <Combo value={wp} onChange={setWp} placeholder="Any work package"
              items={(wps.data ?? []).map((w) => ({ value: w.id, label: `${w.code} ${w.title}`, hint: w.entity?.code ?? "Group" }))} />
          </div>
        )}
        <div className="w-48"><EntitySelect value={entity} onChange={setEntity} groupLabel="Any entity" /></div>
        <OptionSelect className="w-36" value={priority} onChange={setPriority} options={PRIORITY_VALUES} allowNone noneLabel="Any priority" placeholder="Priority" />
        <label className="flex items-center gap-2 text-[13px] text-ink-2"><Switch checked={overdueOnly} onCheckedChange={setOverdueOnly} /> Overdue only</label>
        {view === "list" && <label className="flex items-center gap-2 text-[13px] text-ink-2"><Switch checked={hideDone} onCheckedChange={setHideDone} /> Hide done</label>}
        {filtersActive && <Button size="sm" variant="ghost" onClick={clear}>Clear filters</Button>}
      </div>

      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : view === "board" ? (
        (q.data?.length ?? 0) === 0 && !filtersActive ? (
          <div className="rounded-md border bg-card">
            <Empty title={scope === "mine" ? "No tasks assigned to you" : "No tasks yet"}
              action={<NewTaskDialog trigger={<Button><Plus /> New task</Button>} onCreated={(t) => openTask(t.id)} />}>
              Create a task, or switch to all tasks to see what others are working on.
            </Empty>
          </div>
        ) : (
          <KanbanBoard tasks={tasks} onOpen={openTask} createDefaults={{ work_package_id: wp, assignee_id: me?.id ?? null }} />
        )
      ) : tasks.length === 0 ? (
        <div className="rounded-md border bg-card">
          <Empty title={filtersActive ? "No tasks match the filters" : "No tasks"}>{filtersActive ? "Clear or change the filters to see more tasks." : "Create a task to get started."}</Empty>
        </div>
      ) : (
        <TaskTable tasks={tasks} onOpen={openTask} showAssignee={scope === "all"} />
      )}

      <TaskDrawer />
    </div>
  )
}
