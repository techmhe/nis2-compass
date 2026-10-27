import { useCallback, useState, type KeyboardEvent } from "react"
import { useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { X } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { DocLink, Task, WorkPackage } from "@/lib/types"
import { cn } from "@/lib/utils"

export interface TaskLinks {
  answer: { id: number; assessment_id: number; requirement_id: number; number: string; section: string; entity_code: string } | null
  action_item: { id: number; code: string; title: string; entity_code: string } | null
  activity: { id: number; code: string; title: string; project_id: number } | null
}
export interface TaskDetail { task: Task; documents: DocLink[]; can_edit: boolean; links?: TaskLinks }

export type TaskPatch = Partial<{
  title: string; description: string | null; status: Task["status"]; priority: string; assignee_id: number | null
  start_date: string | null; due_date: string | null; estimate_hours: number | null; labels: string[]
  checklist: { text: string; done: boolean }[]; work_package_id: number | null; sort_order: number
}>

export const STATUS_DOT: Record<string, string> = {
  todo: "bg-ink-3", in_progress: "bg-petrol", review: "bg-brass", blocked: "bg-alarm", done: "bg-sage",
}

/** Refresh every view that shows tasks (lists, detail, my work, work packages, dashboard). */
export function invalidateTaskViews(qc: QueryClient, taskId?: number) {
  qc.invalidateQueries({ queryKey: ["tasks"] })
  if (taskId) qc.invalidateQueries({ queryKey: ["task", taskId] })
  for (const k of ["me-work", "work-package", "work-packages", "dash-home", "gantt", "activities"]) qc.invalidateQueries({ queryKey: [k] })
}

/** Apply a patch to every cached copy of a task (lists and detail). Returns a restore function. */
export function patchTaskCaches(qc: QueryClient, id: number, fields: Partial<Task>): () => void {
  const lists = qc.getQueriesData<Task[]>({ queryKey: ["tasks"] })
  for (const [k, v] of lists) if (Array.isArray(v)) qc.setQueryData(k, v.map((t) => (t.id === id ? { ...t, ...fields } : t)))
  const detail = qc.getQueryData<TaskDetail>(["task", id])
  if (detail) qc.setQueryData<TaskDetail>(["task", id], { ...detail, task: { ...detail.task, ...fields } })
  const wps = qc.getQueriesData<{ tasks: Task[] }>({ queryKey: ["work-package"] })
  for (const [k, v] of wps) if (v && Array.isArray(v.tasks)) qc.setQueryData(k, { ...v, tasks: v.tasks.map((t) => (t.id === id ? { ...t, ...fields } : t)) })
  return () => {
    for (const [k, v] of lists) qc.setQueryData(k, v)
    if (detail) qc.setQueryData(["task", id], detail)
    for (const [k, v] of wps) qc.setQueryData(k, v)
  }
}

/** PATCH /tasks/{id} with optimistic cache updates. `optimistic` lets callers pass derived fields (e.g. the assignee object). */
export function useTaskPatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: TaskPatch; optimistic?: Partial<Task>; quiet?: boolean }) => api.patch<Task>(`/tasks/${id}`, patch),
    onMutate: async ({ id, patch, optimistic }) => {
      await qc.cancelQueries({ queryKey: ["task", id] })
      const { assignee_id: _a, work_package_id: _w, ...plain } = patch
      void _a; void _w
      const fields: Partial<Task> = { ...(plain as Partial<Task>), ...optimistic }
      if (patch.status === "done") fields.overdue = false
      return { restore: patchTaskCaches(qc, id, fields) }
    },
    onError: (e: Error, _v, ctx) => {
      ctx?.restore()
      toast.error(`Could not update the task: ${e.message}`)
    },
    onSuccess: (t) => { patchTaskCaches(qc, t.id, t) },
    onSettled: (_d, _e, v) => invalidateTaskViews(qc, v.id),
  })
}

/** Open/close the task drawer through the ?task= search parameter. */
export function useTaskParam() {
  const [params, setParams] = useSearchParams()
  const id = params.get("task") ? Number(params.get("task")) : null
  const open = useCallback((taskId: number | null) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (taskId == null) p.delete("task")
      else p.set("task", String(taskId))
      return p
    }, { replace: taskId == null })
  }, [setParams])
  return [Number.isFinite(id) ? id : null, open] as const
}

export function useWorkPackageOptions() {
  const { canAny } = useAuth()
  return useQuery({
    queryKey: ["work-packages"],
    queryFn: () => api.get<WorkPackage[]>("/work-packages"),
    enabled: canAny("workpackages.read"),
    staleTime: 60_000,
  })
}

/** Date input that commits on blur (so partially typed dates are never saved). */
export function DateField({ value, onCommit, disabled, className, label }: {
  value: string | null; onCommit: (v: string | null) => void; disabled?: boolean; className?: string; label: string
}) {
  const [local, setLocal] = useState(value ?? "")
  const [seen, setSeen] = useState(value)
  if (value !== seen) { setSeen(value); setLocal(value ?? "") }
  const commit = () => { const v = local || null; if (v !== (value ?? null)) onCommit(v) }
  return (
    <Input type="date" value={local} disabled={disabled} aria-label={label} className={cn("h-8", className)}
      onChange={(e) => setLocal(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit() }} />
  )
}

/** Chip input for labels. */
export function LabelsInput({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState("")
  const add = () => {
    const t = text.trim().replace(/,$/, "")
    if (t && !value.includes(t)) onChange([...value, t.slice(0, 40)])
    setText("")
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add() }
    else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1))
  }
  return (
    <div className={cn("flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-1", disabled && "opacity-60")}>
      {value.map((l) => (
        <span key={l} className="inline-flex h-5 items-center gap-1 rounded-[4px] bg-muted px-1.5 text-[12px] text-ink-2">
          {l}
          {!disabled && <button type="button" aria-label={`Remove label ${l}`} className="text-ink-3 hover:text-alarm" onClick={() => onChange(value.filter((x) => x !== l))}><X className="size-3" /></button>}
        </span>
      ))}
      {!disabled && (
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={add}
          placeholder={value.length ? "" : "Add label"} aria-label="Add label" className="h-6 min-w-[80px] flex-1 bg-transparent px-1 text-[13px] outline-none" />
      )}
    </div>
  )
}

export function StatusDot({ status, className }: { status: string; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_DOT[status] ?? "bg-ink-3", className)} />
}
