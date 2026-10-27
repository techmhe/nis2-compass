import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import {
  closestCorners, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent, type UniqueIdentifier,
} from "@dnd-kit/core"
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CalendarDays, ListChecks, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Code, EntityTag } from "@/components/common/basics"
import { UserAvatar } from "@/components/common/collab"
import { api } from "@/lib/api"
import { TASK_STATUSES } from "@/lib/constants"
import { fmtDateShort } from "@/lib/format"
import type { Task, TaskStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { invalidateTaskViews, patchTaskCaches, StatusDot } from "./common"

type Board = Record<TaskStatus, number[]>
const STATUS_KEYS = TASK_STATUSES.map((s) => s.key) as TaskStatus[]

function groupTasks(tasks: Task[]): Board {
  const b = Object.fromEntries(STATUS_KEYS.map((k) => [k, [] as number[]])) as Board
  const sorted = [...tasks].sort((a, c) => a.sort_order - c.sort_order || a.id - c.id)
  for (const t of sorted) (b[t.status] ?? b.todo).push(t.id)
  return b
}

export function KanbanBoard({ tasks, onOpen, canCreate = true, createDefaults }: {
  tasks: Task[]
  onOpen: (id: number) => void
  canCreate?: boolean
  createDefaults?: { work_package_id?: number | null; assignee_id?: number | null }
}) {
  const qc = useQueryClient()
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const [board, setBoard] = useState<Board>(() => groupTasks(tasks))
  const [activeId, setActiveId] = useState<number | null>(null)
  const origin = useRef<TaskStatus | null>(null)
  const lastDragEnd = useRef(0)

  useEffect(() => {
    if (activeId == null) setBoard(groupTasks(tasks))
  }, [tasks, activeId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findContainer = (id: UniqueIdentifier): TaskStatus | null => {
    if (typeof id === "string" && (STATUS_KEYS as string[]).includes(id)) return id as TaskStatus
    return STATUS_KEYS.find((k) => board[k].includes(Number(id))) ?? null
  }

  const persist = async (updates: { id: number; status?: TaskStatus; sort_order: number }[]) => {
    const restores = updates.map((u) => patchTaskCaches(qc, u.id, { sort_order: u.sort_order, ...(u.status ? { status: u.status, overdue: u.status === "done" ? false : byId.get(u.id)?.overdue ?? false } : {}) }))
    try {
      await Promise.all(updates.map((u) => api.patch<Task>(`/tasks/${u.id}`, u.status ? { status: u.status, sort_order: u.sort_order } : { sort_order: u.sort_order })))
    } catch (e) {
      restores.reverse().forEach((r) => r())
      toast.error(`Could not move the task: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      invalidateTaskViews(qc)
    }
  }

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(Number(e.active.id))
    origin.current = findContainer(e.active.id)
  }

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return
    const from = findContainer(active.id)
    const to = findContainer(over.id)
    if (!from || !to || from === to) return
    setBoard((prev) => {
      const id = Number(active.id)
      const toItems = [...prev[to]]
      const overIndex = toItems.indexOf(Number(over.id))
      const below = active.rect.current.translated && over.rect && active.rect.current.translated.top > over.rect.top + over.rect.height / 2
      const index = overIndex >= 0 ? overIndex + (below ? 1 : 0) : toItems.length
      toItems.splice(index, 0, id)
      return { ...prev, [from]: prev[from].filter((x) => x !== id), [to]: toItems }
    })
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    lastDragEnd.current = Date.now()
    const id = Number(active.id)
    const container = findContainer(active.id)
    if (!over || !container) { setActiveId(null); return }
    let list = board[container]
    const overContainer = findContainer(over.id)
    if (overContainer === container) {
      const oldIndex = list.indexOf(id)
      const newIndex = typeof over.id === "string" ? list.length - 1 : list.indexOf(Number(over.id))
      if (oldIndex !== newIndex && newIndex >= 0) list = arrayMove(list, oldIndex, newIndex)
    }
    const next = { ...board, [container]: list }
    setBoard(next)
    setActiveId(null)

    const task = byId.get(id)
    if (!task) return
    const idx = list.indexOf(id)
    const statusChanged = task.status !== container
    const prevT = idx > 0 ? byId.get(list[idx - 1]) : undefined
    const nextT = idx < list.length - 1 ? byId.get(list[idx + 1]) : undefined
    const positionChanged = (prevT?.id ?? null) !== (neighbour(groupTasks(tasks)[task.status], id, -1)) || (nextT?.id ?? null) !== neighbour(groupTasks(tasks)[task.status], id, 1)
    if (!statusChanged && !positionChanged) return

    let order: number | null
    if (!prevT && !nextT) order = 1
    else if (!prevT) order = nextT!.sort_order - 1
    else if (!nextT) order = prevT.sort_order + 1
    else order = nextT.sort_order - prevT.sort_order > 1e-6 ? (prevT.sort_order + nextT.sort_order) / 2 : null

    if (order != null) {
      persist([{ id, sort_order: order, ...(statusChanged ? { status: container } : {}) }])
    } else {
      // neighbours share the same order value: renumber the whole column
      const updates = list.map((tid, i) => ({ id: tid, sort_order: i + 1, ...(tid === id && statusChanged ? { status: container } : {}) }))
        .filter((u) => u.id === id || byId.get(u.id)?.sort_order !== u.sort_order)
      persist(updates)
    }
    if (statusChanged) {
      const label = TASK_STATUSES.find((s) => s.key === container)?.label ?? container
      toast.success(`${task.key} moved to ${label.toLowerCase()}`)
    }
  }

  const onDragCancel = () => {
    setActiveId(null)
    setBoard(groupTasks(tasks))
  }

  const open = (id: number) => {
    if (Date.now() - lastDragEnd.current < 250) return
    onOpen(id)
  }

  const active = activeId != null ? byId.get(activeId) : undefined

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver}
      onDragEnd={onDragEnd} onDragCancel={onDragCancel}
      accessibility={{
        screenReaderInstructions: { draggable: "To pick up a task, press space or enter. Use the arrow keys to move it between columns and positions. Press space or enter again to drop, or escape to cancel." },
      }}>
      <div className="grid auto-cols-[minmax(208px,1fr)] grid-flow-col gap-2.5 overflow-x-auto pb-2 scroll-thin">
        {TASK_STATUSES.map((s) => (
          <Column key={s.key} status={s.key} label={s.label} ids={board[s.key]} byId={byId} onOpen={open}
            canCreate={canCreate} createDefaults={createDefaults} />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {active ? <TaskCard task={active} overlay /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function neighbour(list: number[], id: number, dir: -1 | 1): number | null {
  const i = list.indexOf(id)
  if (i < 0) return null
  return list[i + dir] ?? null
}

function Column({ status, label, ids, byId, onOpen, canCreate, createDefaults }: {
  status: TaskStatus; label: string; ids: number[]; byId: Map<number, Task>; onOpen: (id: number) => void
  canCreate: boolean; createDefaults?: { work_package_id?: number | null; assignee_id?: number | null }
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const overdue = ids.filter((id) => byId.get(id)?.overdue).length
  return (
    <section aria-label={`${label} column`} className={cn("flex max-h-[calc(100vh-270px)] min-h-[320px] flex-col rounded-md border bg-muted/50", isOver && "border-petrol/50 bg-petrol-50/40")}>
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <StatusDot status={status} />
        <h3 className="text-[13px] font-semibold text-ink">{label}</h3>
        <span className="tabular rounded-full bg-card px-1.5 text-[11.5px] text-ink-3">{ids.length}</span>
        {overdue > 0 && status !== "done" && <span className="tabular ml-auto text-[11.5px] font-medium text-alarm">{overdue} overdue</span>}
      </header>
      <SortableContext id={status} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 scroll-thin">
          {ids.map((id) => {
            const t = byId.get(id)
            return t ? <SortableCard key={id} task={t} onOpen={onOpen} /> : null
          })}
          {ids.length === 0 && (
            <div className="flex flex-1 items-center justify-center rounded-md border border-dashed px-3 py-6 text-center text-[12.5px] text-ink-3">
              Drop tasks here
            </div>
          )}
        </div>
      </SortableContext>
      {canCreate && <QuickAdd status={status} defaults={createDefaults} />}
    </section>
  )
}

function SortableCard({ task, onOpen }: { task: Task; onOpen: (id: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      aria-label={`${task.key} ${task.title}`} aria-roledescription="Draggable task"
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !isDragging) { e.preventDefault(); onOpen(task.id) }
        else listeners?.onKeyDown?.(e)
      }}
      className={cn("rounded-md outline-none focus-visible:ring-2 focus-visible:ring-petrol", isDragging && "opacity-40")}>
      <TaskCard task={task} />
    </div>
  )
}

export function TaskCard({ task: t, overlay }: { task: Task; overlay?: boolean }) {
  const done = t.checklist.filter((c) => c.done).length
  return (
    <div className={cn("cursor-grab rounded-md border bg-card p-2.5 text-[13px] select-none hover:border-input active:cursor-grabbing",
      overlay && "rotate-[1.5deg] cursor-grabbing border-petrol/40 shadow-lg", t.status === "done" && "opacity-80")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-1.5">
            <Code className="text-[11.5px] text-ink-3">{t.key}</Code>
            {t.priority === "High" && <span className="size-1.5 rounded-full bg-alarm" title="High priority" />}
            {t.priority === "Medium" && <span className="size-1.5 rounded-full bg-amber" title="Medium priority" />}
          </div>
          <div className={cn("line-clamp-3 leading-snug text-ink", t.status === "done" && "text-ink-2 line-through decoration-ink-3/60")}>{t.title}</div>
        </div>
        {t.assignee && <span title={t.assignee.display_name}><UserAvatar name={t.assignee.display_name} className="size-6" /></span>}
      </div>
      {(t.work_package || t.entity || t.labels.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {t.work_package && <span className="rounded-[4px] border bg-surface px-1 font-mono text-[11px] leading-[18px] text-ink-2" title={t.work_package.title}>{t.work_package.code}</span>}
          {t.entity && <EntityTag code={t.entity.code} name={t.entity.name} className="text-[11px] leading-[18px]" />}
          {t.labels.slice(0, 3).map((l) => <span key={l} className="rounded-[4px] bg-muted px-1.5 text-[11px] leading-[18px] text-ink-2">{l}</span>)}
          {t.labels.length > 3 && <span className="text-[11px] text-ink-3">+{t.labels.length - 3}</span>}
        </div>
      )}
      {(t.due_date || t.checklist.length > 0) && (
        <div className="mt-2 flex items-center gap-3 text-[12px] text-ink-3">
          {t.due_date && (
            <span className={cn("tabular inline-flex items-center gap-1", t.overdue && "font-medium text-alarm")} title={t.overdue ? "Overdue" : "Due date"}>
              <CalendarDays className="size-3.5" />{fmtDateShort(t.due_date)}
            </span>
          )}
          {t.checklist.length > 0 && (
            <span className={cn("tabular inline-flex items-center gap-1", done === t.checklist.length && "text-sage")}>
              <ListChecks className="size-3.5" />{done}/{t.checklist.length}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function QuickAdd({ status, defaults }: { status: TaskStatus; defaults?: { work_package_id?: number | null; assignee_id?: number | null } }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const create = useMutation({
    mutationFn: () => api.post<Task>("/tasks", { title: title.trim(), status, work_package_id: defaults?.work_package_id ?? null, assignee_id: defaults?.assignee_id ?? null }),
    onSuccess: (t) => { toast.success(`Created ${t.key}`); setTitle(""); invalidateTaskViews(qc) },
    onError: (e: Error) => toast.error(`Could not create the task: ${e.message}`),
  })
  if (!open) {
    return (
      <div className="px-2 pb-2">
        <Button size="sm" variant="ghost" className="w-full justify-start text-ink-3" onClick={() => setOpen(true)}><Plus /> Add task</Button>
      </div>
    )
  }
  return (
    <form className="space-y-1.5 px-2 pb-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) create.mutate() }}>
      <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" aria-label="New task title" className="h-8 bg-card"
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setTitle("") } }} />
      <div className="flex gap-1.5">
        <Button size="xs" type="submit" disabled={!title.trim() || create.isPending}>Add task</Button>
        <Button size="xs" variant="ghost" type="button" onClick={() => { setOpen(false); setTitle("") }}>Cancel</Button>
      </div>
    </form>
  )
}
