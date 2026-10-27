import { useMemo, useState } from "react"
import { Link } from "react-router"
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Code, EntityTag, PriorityPill, StatusPill } from "@/components/common/basics"
import { UserAvatar } from "@/components/common/collab"
import { fmtDate, fromNow } from "@/lib/format"
import type { Task } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useTaskPatch } from "./common"

type SortKey = "key" | "title" | "status" | "priority" | "assignee" | "wp" | "entity" | "due" | "updated"
const STATUS_ORDER: Record<string, number> = { todo: 0, in_progress: 1, review: 2, blocked: 3, done: 4 }
const PRIO_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 }

function cmp(a: Task, b: Task, k: SortKey): number {
  const s = (x: string | null | undefined, y: string | null | undefined) => (x ?? "￿").localeCompare(y ?? "￿")
  switch (k) {
    case "key": return Number(a.key.replace(/\D/g, "")) - Number(b.key.replace(/\D/g, ""))
    case "title": return a.title.localeCompare(b.title)
    case "status": return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    case "priority": return (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9)
    case "assignee": return s(a.assignee?.display_name, b.assignee?.display_name)
    case "wp": return s(a.work_package?.code, b.work_package?.code)
    case "entity": return s(a.entity?.code, b.entity?.code)
    case "due": return s(a.due_date, b.due_date)
    case "updated": return b.updated_at.localeCompare(a.updated_at)
  }
}

export function TaskTable({ tasks, onOpen, showAssignee = true }: { tasks: Task[]; onOpen: (id: number) => void; showAssignee?: boolean }) {
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "due", dir: 1 })
  const patch = useTaskPatch()
  const rows = useMemo(() => [...tasks].sort((a, b) => cmp(a, b, sort.k) * sort.dir || a.id - b.id), [tasks, sort])
  const head = (k: SortKey, label: string, cls?: string) => (
    <th className={cls} aria-sort={sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort((p) => ({ k, dir: p.k === k ? (p.dir === 1 ? -1 : 1) : 1 }))}>
        {label}
        {sort.k === k ? (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ChevronsUpDown className="size-3 opacity-40" />}
      </button>
    </th>
  )
  return (
    <div className="overflow-x-auto rounded-md border bg-card scroll-thin">
      <table className="w-full min-w-[980px] border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="text-left text-[12px] text-ink-3 [&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
            <th className="w-[36px]"><span className="sr-only">Done</span></th>
            {head("key", "Key", "w-[70px]")}
            {head("title", "Title")}
            {head("status", "Status", "w-[110px]")}
            {head("priority", "Priority", "w-[90px]")}
            {showAssignee && head("assignee", "Assignee", "w-[170px]")}
            {head("wp", "Work package", "w-[110px]")}
            {head("entity", "Entity", "w-[70px]")}
            {head("due", "Due", "w-[110px]")}
            {head("updated", "Updated", "w-[110px]")}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="cursor-pointer hover:bg-muted/40 [&>td]:border-b [&>td]:px-3 [&>td]:py-2" onClick={() => onOpen(t.id)}>
              <td onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={t.status === "done"} aria-label={t.status === "done" ? `Reopen ${t.key}` : `Mark ${t.key} as done`}
                  onCheckedChange={(v) => patch.mutate({ id: t.id, patch: { status: v === true ? "done" : "todo" } })} />
              </td>
              <td><Code>{t.key}</Code></td>
              <td>
                <button className={cn("text-left hover:text-petrol", t.status === "done" ? "text-ink-3 line-through" : "text-ink")} onClick={(e) => { e.stopPropagation(); onOpen(t.id) }}>{t.title}</button>
                {t.labels.length > 0 && <span className="ml-2 inline-flex gap-1 align-middle">{t.labels.slice(0, 3).map((l) => <span key={l} className="rounded-[4px] bg-muted px-1.5 text-[11px] leading-[18px] text-ink-2">{l}</span>)}</span>}
              </td>
              <td><StatusPill value={t.status} /></td>
              <td><PriorityPill value={t.priority} /></td>
              {showAssignee && (
                <td>{t.assignee ? <span className="inline-flex items-center gap-1.5 text-ink-2"><UserAvatar name={t.assignee.display_name} className="size-5" />{t.assignee.display_name}</span> : <span className="text-ink-3">Unassigned</span>}</td>
              )}
              <td onClick={(e) => e.stopPropagation()}>
                {t.work_package ? <Link to={`/work-packages/${t.work_package.id}`} className="hover:text-petrol" title={t.work_package.title}><Code>{t.work_package.code}</Code></Link> : <span className="text-ink-3">–</span>}
              </td>
              <td>{t.entity ? <EntityTag code={t.entity.code} name={t.entity.name} /> : <span className="text-ink-3">–</span>}</td>
              <td className={cn("tabular", t.overdue ? "font-medium text-alarm" : "text-ink-2")}>{fmtDate(t.due_date)}</td>
              <td className="text-[12.5px] text-ink-3">{fromNow(t.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
