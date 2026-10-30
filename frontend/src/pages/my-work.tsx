import { useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { addDays, differenceInCalendarDays, format, isWeekend, parseISO, startOfDay } from "date-fns"
import {
  CalendarRange, ClipboardCheck, ClipboardList, Diamond, FileText, FolderKanban, Inbox, ListChecks, PackageCheck, Plus, ShieldAlert, Siren, X, Landmark, CalendarCheck, Truck
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Code, Empty, EntityTag, ErrorState, Loading, PageHeader, Pill, StatusPill } from "@/components/common/basics"
import { patchTaskCaches, invalidateTaskViews, useTaskParam } from "@/components/tasks/common"
import { NewTaskDialog } from "@/components/tasks/new-task-dialog"
import { TaskDrawer } from "@/components/tasks/task-drawer"
import { ApprovalsWaiting } from "@/components/approvals/waiting-list"
import { api } from "@/lib/api"
import type { Task } from "@/lib/types"
import { cn } from "@/lib/utils"

interface MyWork {
  stakeholders: string[]
  tasks: Task[]
  reported_open: Task[]
  answers: { answer_id: number; assessment_id: number; entity_code: string; requirement_id: number; number: string; section: string; state: string; finding_id: string | null; target_date: string | null }[]
  assessments: { id: number; entity_code: string; entity_name: string; round: string; status: string; due_date: string | null }[]
  action_items: { id: number; code: string; title: string; entity_code: string; requirement: string; status: string; priority: string; target_date: string | null; due_status: string | null }[]
  work_packages: { id: number; code: string; title: string; status: string; priority: string; planned_finish: string | null; schedule_status: string }[]
  activities: { id: number; project_id: number; code: string; title: string; status: string; planned_finish: string | null; schedule_status: string }[]
  raid: { id: number; project_id: number; code: string; type: string; title: string; status: string; target_date: string | null; due_status: string | null }[]
  gates: { id: number; project_id: number; code: string; decision: string | null; planned_date: string | null; status: string }[]
  documents: { id: number; title: string; status: string; next_review_date: string | null; overdue: boolean }[]
  incidents: { id: number; code: string; title: string; status: string; severity: string }[]
  counts: Record<string, number>
  overdue: number
  extra?: ExtraItem[]
}

type Kind = "task" | "answer" | "assessment" | "action_item" | "work_package" | "activity" | "raid" | "gate" | "document" | "incident"
  | "obligation" | "registration_change" | "risk_review" | "control_occurrence" | "supplier_review" | "other"

interface ExtraItem { kind: string; kind_label: string; id: number; code: string | null; title: string; entity_code: string | null; due: string | null; href: string; status: string | null }

const KINDS: { key: Kind; label: string; icon: ReactNode }[] = [
  { key: "task", label: "Tasks", icon: <FolderKanban /> },
  { key: "answer", label: "Assessment questions", icon: <ClipboardCheck /> },
  { key: "assessment", label: "Assessments I lead", icon: <ClipboardList /> },
  { key: "action_item", label: "Action plan items", icon: <ListChecks /> },
  { key: "work_package", label: "Work packages", icon: <PackageCheck /> },
  { key: "activity", label: "Master plan activities", icon: <CalendarRange /> },
  { key: "raid", label: "Risks and issues", icon: <ShieldAlert /> },
  { key: "gate", label: "Gate decisions", icon: <Diamond /> },
  { key: "document", label: "Document reviews", icon: <FileText /> },
  { key: "incident", label: "Incidents", icon: <Siren /> },
  { key: "obligation", label: "Obligations", icon: <Landmark /> },
  { key: "registration_change", label: "Registration changes", icon: <Landmark /> },
  { key: "risk_review", label: "Risk reviews", icon: <ShieldAlert /> },
  { key: "control_occurrence", label: "Control activities", icon: <CalendarCheck /> },
  { key: "supplier_review", label: "Supplier reviews", icon: <Truck /> },
  { key: "other", label: "Other", icon: <Inbox /> },
]
const KIND_MAP = Object.fromEntries(KINDS.map((k) => [k.key, k])) as Record<Kind, (typeof KINDS)[number]>
const KIND_DOT: Record<Kind, string> = {
  task: "bg-petrol", answer: "bg-ink-2", assessment: "bg-ink-2", action_item: "bg-amber", work_package: "bg-petrol",
  activity: "bg-ink-3", raid: "bg-alarm", gate: "bg-brass", document: "bg-sage", incident: "bg-alarm",
  obligation: "bg-brass", registration_change: "bg-alarm", risk_review: "bg-alarm", control_occurrence: "bg-petrol",
  supplier_review: "bg-ink-2", other: "bg-ink-3",
}

interface Item {
  uid: string
  kind: Kind
  id: number
  code?: string
  title: string
  entity?: string
  due: Date | null
  href: string
  status?: ReactNode
  task?: Task
}

type Bucket = "overdue" | "week" | "later" | "none"
const BUCKETS: { key: Bucket; title: string; hint: string }[] = [
  { key: "overdue", title: "Overdue", hint: "Past the due or target date" },
  { key: "week", title: "This week", hint: "Due within the next 7 days" },
  { key: "later", title: "Later", hint: "Due after the next 7 days" },
  { key: "none", title: "No due date", hint: "Open items without a date" },
]

const d = (s: string | null | undefined) => (s ? parseISO(s) : null)

function buildItems(w: MyWork): Item[] {
  const out: Item[] = []
  for (const t of w.tasks) out.push({ uid: `t${t.id}`, kind: "task", id: t.id, code: t.key, title: t.title, entity: t.entity?.code, due: d(t.due_date), href: `/tasks?task=${t.id}`, status: <StatusPill value={t.status} />, task: t })
  for (const a of w.answers) out.push({
    uid: `a${a.answer_id}`, kind: "answer", id: a.answer_id, code: a.number, title: a.section, entity: a.entity_code, due: d(a.target_date),
    href: `/assessments/${a.assessment_id}?req=${a.requirement_id}`,
    status: <Pill tone={a.state === "finding" ? "amber" : "neutral"}>{a.state === "finding" ? "Finding to close" : "Open question"}</Pill>,
  })
  for (const a of w.assessments) out.push({ uid: `s${a.id}`, kind: "assessment", id: a.id, title: `${a.entity_name}, ${a.round}`, entity: a.entity_code, due: d(a.due_date), href: `/assessments/${a.id}`, status: <StatusPill value={a.status} /> })
  for (const i of w.action_items) out.push({ uid: `i${i.id}`, kind: "action_item", id: i.id, code: i.code, title: i.title, entity: i.entity_code, due: d(i.target_date), href: `/action-plan?item=${i.id}`, status: <StatusPill value={i.status} /> })
  for (const p of w.work_packages) out.push({ uid: `w${p.id}`, kind: "work_package", id: p.id, code: p.code, title: p.title, due: d(p.planned_finish), href: `/work-packages/${p.id}`, status: <StatusPill value={p.status} /> })
  for (const a of w.activities) out.push({ uid: `p${a.id}`, kind: "activity", id: a.id, code: a.code, title: a.title, due: d(a.planned_finish), href: `/projects/${a.project_id}/plan?activity=${a.id}`, status: <StatusPill value={a.status} /> })
  for (const r of w.raid) out.push({ uid: `r${r.id}`, kind: "raid", id: r.id, code: r.code, title: r.title, due: d(r.target_date), href: `/projects/${r.project_id}/raid?record=${r.id}`, status: <Pill tone="outline">{r.type}</Pill> })
  for (const g of w.gates) out.push({ uid: `g${g.id}`, kind: "gate", id: g.id, code: g.code, title: g.decision ?? "Gate decision", due: d(g.planned_date), href: `/projects/${g.project_id}/gates`, status: <StatusPill value={g.status} /> })
  for (const doc of w.documents) out.push({ uid: `d${doc.id}`, kind: "document", id: doc.id, title: doc.title, due: d(doc.next_review_date), href: `/documents/${doc.id}`, status: <StatusPill value={doc.status} /> })
  // A module may return several rows for one object (e.g. two report stages of the same incident), so kind and
  // id alone do not identify a row.
  const seen = new Map<string, number>()
  for (const x of w.extra ?? []) {
    const kind = (KIND_MAP[x.kind as Kind] ? x.kind : "other") as Kind
    const base = `x-${x.kind}-${x.id}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    out.push({ uid: n === 1 ? base : `${base}-${n}`, kind, id: x.id, code: x.code ?? undefined, title: x.title, entity: x.entity_code ?? undefined,
      due: d(x.due), href: x.href, status: x.status ? <span className="text-[12px] text-ink-3">{x.status}</span> : undefined })
  }
  for (const i of w.incidents) out.push({ uid: `n${i.id}`, kind: "incident", id: i.id, code: i.code, title: i.title, due: null, href: `/incidents/${i.id}`, status: <StatusPill value={i.severity} /> })
  return out
}

function bucketOf(due: Date | null, today: Date): Bucket {
  if (!due) return "none"
  const diff = differenceInCalendarDays(due, today)
  return diff < 0 ? "overdue" : diff <= 6 ? "week" : "later"
}

function dueLabel(due: Date | null, today: Date): { text: string; tone: string } {
  if (!due) return { text: "", tone: "" }
  const diff = differenceInCalendarDays(due, today)
  if (diff < 0) return { text: diff === -1 ? "1 day overdue" : `${-diff} days overdue`, tone: "text-alarm font-medium" }
  if (diff === 0) return { text: "Today", tone: "text-amber font-medium" }
  if (diff === 1) return { text: "Tomorrow", tone: "text-amber" }
  if (diff <= 6) return { text: format(due, "EEE d MMM"), tone: "text-ink-2" }
  return { text: format(due, due.getFullYear() === today.getFullYear() ? "d MMM" : "d MMM yyyy"), tone: "text-ink-3" }
}

export default function MyWorkPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [, openTask] = useTaskParam()
  const q = useQuery({ queryKey: ["me-work"], queryFn: () => api.get<MyWork>("/me/work") })
  const [kind, setKind] = useState<Kind | "all">("all")
  const [day, setDay] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<Bucket>>(new Set())
  const [newTask, setNewTask] = useState(false)
  const today = useMemo(() => startOfDay(new Date()), [])

  const items = useMemo(() => (q.data ? buildItems(q.data) : []), [q.data])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length }
    for (const i of items) c[i.kind] = (c[i.kind] ?? 0) + 1
    return c
  }, [items])

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i)), [today])
  const agenda = useMemo(() => {
    const m = new Map<string, Item[]>()
    let overdue = 0
    for (const i of items) {
      if (kind !== "all" && i.kind !== kind) continue
      if (!i.due) continue
      const diff = differenceInCalendarDays(i.due, today)
      if (diff < 0) overdue++
      else if (diff < 14) {
        const k = format(i.due, "yyyy-MM-dd")
        m.set(k, [...(m.get(k) ?? []), i])
      }
    }
    return { m, overdue }
  }, [items, kind, today])

  const filtered = useMemo(() => items.filter((i) => (kind === "all" || i.kind === kind)
    && (!day || (day === "overdue" ? !!i.due && i.due < today : !!i.due && format(i.due, "yyyy-MM-dd") === day))), [items, kind, day, today])

  const buckets = useMemo(() => {
    const b: Record<Bucket, Item[]> = { overdue: [], week: [], later: [], none: [] }
    for (const i of filtered) b[bucketOf(i.due, today)].push(i)
    for (const k of Object.keys(b) as Bucket[]) b[k].sort((x, y) => (x.due?.getTime() ?? 0) - (y.due?.getTime() ?? 0) || KINDS.findIndex((k2) => k2.key === x.kind) - KINDS.findIndex((k2) => k2.key === y.kind))
    return b
  }, [filtered, today])

  const completeTask = async (t: Task) => {
    const prevWork = qc.getQueryData<MyWork>(["me-work"])
    qc.setQueryData<MyWork>(["me-work"], (old) => old && { ...old, tasks: old.tasks.filter((x) => x.id !== t.id) })
    const restore = patchTaskCaches(qc, t.id, { status: "done", overdue: false })
    try {
      await api.patch(`/tasks/${t.id}`, { status: "done" })
      toast.success(`${t.key} marked as done`, {
        action: {
          label: "Undo",
          onClick: () => {
            api.patch(`/tasks/${t.id}`, { status: t.status }).then(() => invalidateTaskViews(qc, t.id), (e: Error) => toast.error(`Could not reopen ${t.key}: ${e.message}`))
          },
        },
      })
      invalidateTaskViews(qc, t.id)
    } catch (e) {
      if (prevWork) qc.setQueryData(["me-work"], prevWork)
      restore()
      toast.error(`Could not complete ${t.key}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const open = (i: Item) => (i.kind === "task" ? openTask(i.id) : navigate(i.href))

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState error={q.error} />
  const w = q.data!
  const overdueTotal = items.filter((i) => i.due && i.due < today).length

  return (
    <div>
      <div data-tour="welcome.my-work">
      <PageHeader title="My work"
        description={w.stakeholders.length
          ? <>Everything assigned to you or to your roles ({w.stakeholders.join(", ")}), sorted by urgency.</>
          : "Everything assigned to you, sorted by urgency. Ask an administrator to link your user to a stakeholder role to also see role-based items."}
        actions={<Button onClick={() => setNewTask(true)}><Plus /> New task</Button>} />
      </div>

      {w.incidents.length > 0 && (
        <button onClick={() => navigate(`/incidents/${w.incidents[0].id}`)}
          className="mb-4 flex w-full items-center gap-3 rounded-md border border-alarm/30 bg-alarm-50 px-4 py-2.5 text-left text-[13px] text-alarm hover:border-alarm/60">
          <Siren className="size-4 shrink-0" />
          <span className="flex-1">You handle {w.incidents.length} open incident{w.incidents.length === 1 ? "" : "s"}. Check the NIS2 reporting deadlines.</span>
          <span className="font-medium">Open {w.incidents[0].code}</span>
        </button>
      )}

      <ApprovalsWaiting className="mb-4" />

      <AgendaStrip days={days} agenda={agenda.m} overdue={agenda.overdue} selected={day} onSelect={setDay} />

      <div className="mt-5 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Filter by kind" data-tour="answer.my-work" className="lg:sticky lg:top-[72px] lg:self-start">
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            <KindButton active={kind === "all"} onClick={() => setKind("all")} icon={<Inbox />} label="Everything" count={counts.all ?? 0} />
            {KINDS.filter((k) => counts[k.key]).map((k) => (
              <KindButton key={k.key} active={kind === k.key} onClick={() => setKind(k.key)} icon={k.icon} label={k.label} count={counts[k.key] ?? 0} />
            ))}
          </ul>
          {overdueTotal > 0 && <p className="mt-3 hidden px-2.5 text-[12.5px] text-alarm lg:block">{overdueTotal} item{overdueTotal === 1 ? " is" : "s are"} overdue.</p>}
        </nav>

        <div className="space-y-5">
          {day && (
            <div className="flex items-center gap-2 text-[13px] text-ink-2">
              Showing {day === "overdue" ? "overdue items" : `items due ${format(parseISO(day), "EEEE d MMMM")}`}
              <Button size="xs" variant="outline" onClick={() => setDay(null)}><X /> Show all dates</Button>
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="rounded-md border bg-card">
              <Empty title={items.length ? "Nothing here" : "Nothing on your plate"}
                action={!items.length && <Button variant="outline" onClick={() => setNewTask(true)}><Plus /> New task</Button>}>
                {items.length ? "No open items match this filter. Choose another kind or date." : "No tasks, questions or project items are assigned to you or your roles right now."}
              </Empty>
            </div>
          ) : BUCKETS.map((b) => {
            const list = buckets[b.key]
            if (list.length === 0) return null
            const limit = expanded.has(b.key) ? list.length : 12
            return (
              <section key={b.key} aria-labelledby={`bucket-${b.key}`} className="rounded-md border bg-card">
                <header className="flex items-baseline gap-2 border-b px-4 py-2.5">
                  <h2 id={`bucket-${b.key}`} className={cn("text-[13.5px] font-semibold", b.key === "overdue" ? "text-alarm" : "text-ink")}>{b.title}</h2>
                  <span className="tabular text-[12.5px] text-ink-3">{list.length}</span>
                  <span className="ml-auto text-[12px] text-ink-3">{b.hint}</span>
                </header>
                <ul>
                  {list.slice(0, limit).map((i) => <ItemRow key={i.uid} item={i} today={today} onOpen={() => open(i)} onComplete={completeTask} />)}
                </ul>
                {list.length > limit && (
                  <div className="border-t px-4 py-2">
                    <Button size="sm" variant="ghost" onClick={() => setExpanded((s) => new Set(s).add(b.key))}>Show {list.length - limit} more</Button>
                  </div>
                )}
              </section>
            )
          })}

          {w.reported_open.length > 0 && (kind === "all" || kind === "task") && !day && (
            <section className="rounded-md border bg-card">
              <header className="flex items-baseline gap-2 border-b px-4 py-2.5">
                <h2 className="text-[13.5px] font-semibold text-ink">Waiting on others</h2>
                <span className="tabular text-[12.5px] text-ink-3">{w.reported_open.length}</span>
                <span className="ml-auto text-[12px] text-ink-3">Open tasks you created for someone else</span>
              </header>
              <ul>
                {w.reported_open.map((t) => {
                  const due = dueLabel(d(t.due_date), today)
                  return (
                    <li key={t.id} className="flex items-center gap-3 border-b px-4 py-2 last:border-0 hover:bg-muted/40">
                      <FolderKanban className="size-4 shrink-0 text-ink-3" />
                      <Code className="w-12 shrink-0">{t.key}</Code>
                      <button onClick={() => openTask(t.id)} className="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:text-petrol">{t.title}</button>
                      <span className="shrink-0 text-[12.5px] text-ink-3">{t.assignee?.display_name ?? "Unassigned"}</span>
                      <StatusPill value={t.status} />
                      <span className={cn("tabular w-28 shrink-0 text-right text-[12.5px]", due.tone)}>{due.text}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </div>
      </div>

      <NewTaskDialog open={newTask} onOpenChange={setNewTask} onCreated={(t) => openTask(t.id)} />
      <TaskDrawer />
    </div>
  )
}

function KindButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; count: number }) {
  return (
    <li>
      <button onClick={onClick} aria-pressed={active}
        className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] [&_svg]:size-4 [&_svg]:shrink-0",
          active ? "bg-card font-medium text-ink ring-1 ring-border" : "text-ink-2 hover:bg-muted")}>
        <span className={active ? "text-petrol" : "text-ink-3"}>{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        <span className="tabular text-[12px] text-ink-3">{count}</span>
      </button>
    </li>
  )
}

function ItemRow({ item: i, today, onOpen, onComplete }: { item: Item; today: Date; onOpen: () => void; onComplete: (t: Task) => void }) {
  const k = KIND_MAP[i.kind]
  const due = dueLabel(i.due, today)
  return (
    <li className="group flex items-center gap-3 border-b px-4 py-2 last:border-0 hover:bg-muted/40">
      {i.task ? (
        <Checkbox aria-label={`Mark ${i.code} as done`} onCheckedChange={(v) => v === true && onComplete(i.task!)} />
      ) : (
        <span className="flex size-4 shrink-0 items-center justify-center text-ink-3 [&_svg]:size-4" title={k.label}>{k.icon}</span>
      )}
      {i.code && <Code className="w-14 shrink-0 truncate">{i.code}</Code>}
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[13px] text-ink group-hover:text-petrol">{i.title}</span>
        <span className="block text-[11.5px] text-ink-3">{k.label}</span>
      </button>
      {i.entity && <EntityTag code={i.entity} />}
      <span className="hidden shrink-0 sm:inline-flex">{i.status}</span>
      <span className={cn("tabular w-28 shrink-0 text-right text-[12.5px]", due.tone)}>{due.text}</span>
      <Button size="xs" variant="ghost" onClick={onOpen} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">Open</Button>
    </li>
  )
}

function AgendaStrip({ days, agenda, overdue, selected, onSelect }: {
  days: Date[]; agenda: Map<string, Item[]>; overdue: number; selected: string | null; onSelect: (v: string | null) => void
}) {
  return (
    <section aria-label="Next 14 days" className="overflow-x-auto rounded-md border bg-card scroll-thin">
      <div className="grid min-w-[860px] grid-cols-[96px_repeat(14,minmax(0,1fr))]">
        <button onClick={() => onSelect(selected === "overdue" ? null : "overdue")} aria-pressed={selected === "overdue"}
          className={cn("flex flex-col items-start justify-between border-r px-3 py-2.5 text-left", overdue ? "bg-alarm-50" : "", selected === "overdue" && "ring-2 ring-alarm ring-inset")}>
          <span className={cn("text-[12px]", overdue ? "text-alarm" : "text-ink-3")}>Overdue</span>
          <span className={cn("tabular text-[22px] leading-tight font-semibold", overdue ? "text-alarm" : "text-ink-3")}>{overdue}</span>
        </button>
        {days.map((dd, idx) => {
          const key = format(dd, "yyyy-MM-dd")
          const list = agenda.get(key) ?? []
          const kinds = [...new Set(list.map((i) => i.kind))]
          const isToday = idx === 0
          const sel = selected === key
          const weekend = isWeekend(dd)
          return (
            <button key={key} onClick={() => list.length && onSelect(sel ? null : key)} disabled={!list.length} aria-pressed={sel}
              aria-label={`${format(dd, "EEEE d MMMM")}: ${list.length} item${list.length === 1 ? "" : "s"} due`}
              title={list.map((i) => `${i.code ?? ""} ${i.title}`.trim()).join("\n") || undefined}
              className={cn("flex min-h-[74px] flex-col items-start gap-1 border-r px-2 py-2 text-left last:border-r-0 disabled:cursor-default",
                weekend && "bg-muted/50", list.length > 0 && "hover:bg-petrol-50/60", sel && "bg-petrol-50 ring-2 ring-petrol ring-inset",
                idx === 7 && "border-l-2 border-l-border")}>
              <span className={cn("text-[11.5px]", isToday ? "font-semibold text-petrol" : "text-ink-3")}>{isToday ? "Today" : format(dd, "EEE")}</span>
              <span className={cn("tabular text-[15px] leading-none font-semibold", isToday ? "text-petrol" : list.length ? "text-ink" : "text-ink-3")}>{format(dd, "d")}</span>
              {list.length > 0 && (
                <span className="mt-auto flex items-center gap-1">
                  <span className="flex gap-0.5">{kinds.slice(0, 4).map((k) => <span key={k} className={cn("size-1.5 rounded-full", KIND_DOT[k])} />)}</span>
                  <span className="tabular text-[11.5px] text-ink-2">{list.length}</span>
                </span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

