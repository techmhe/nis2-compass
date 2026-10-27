import { useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Combo, Field, OptionSelect, UserSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { PRIORITY_VALUES, TASK_STATUSES } from "@/lib/constants"
import type { Task } from "@/lib/types"
import { invalidateTaskViews, LabelsInput, StatusDot, useWorkPackageOptions } from "./common"

export interface NewTaskDefaults {
  status?: Task["status"]
  work_package_id?: number | null
  answer_id?: number | null
  action_item_id?: number | null
  activity_id?: number | null
  assignee_id?: number | null
  title?: string
}

export function NewTaskDialog({ trigger, defaults, onCreated, open: openProp, onOpenChange }: {
  trigger?: ReactNode
  defaults?: NewTaskDefaults
  onCreated?: (t: Task) => void
  open?: boolean
  onOpenChange?: (v: boolean) => void
}) {
  const { me, canAny } = useAuth()
  const qc = useQueryClient()
  const wps = useWorkPackageOptions()
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (v: boolean) => { onOpenChange?.(v); if (openProp === undefined) setOpenState(v) }
  const init = () => ({
    title: defaults?.title ?? "", description: "", status: defaults?.status ?? "todo", priority: "Medium",
    assignee_id: defaults?.assignee_id !== undefined ? defaults.assignee_id : me?.id ?? null,
    start_date: "", due_date: "", estimate: "", labels: [] as string[], work_package_id: defaults?.work_package_id ?? null,
  })
  const [f, setF] = useState(init)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) { setWasOpen(open); if (open) setF(init()) }
  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) => setF((p) => ({ ...p, [k]: v }))
  const canAssignOthers = canAny("tasks.manage") || !!f.work_package_id || !!defaults?.answer_id || !!defaults?.action_item_id

  const create = useMutation({
    mutationFn: () => {
      const est = f.estimate.trim() ? Number(f.estimate.replace(",", ".")) : null
      if (est != null && (!Number.isFinite(est) || est < 0)) throw new Error("The estimate must be a positive number of hours")
      return api.post<Task>("/tasks", {
        title: f.title.trim(), description: f.description.trim() || null, status: f.status, priority: f.priority,
        assignee_id: f.assignee_id, start_date: f.start_date || null, due_date: f.due_date || null, estimate_hours: est,
        labels: f.labels, checklist: [], work_package_id: f.work_package_id,
        answer_id: defaults?.answer_id ?? null, action_item_id: defaults?.action_item_id ?? null, activity_id: defaults?.activity_id ?? null,
      })
    },
    onSuccess: (t) => {
      toast.success(`Created ${t.key}`)
      invalidateTaskViews(qc)
      setOpen(false)
      onCreated?.(t)
    },
    onError: (e: Error) => toast.error(`Could not create the task: ${e.message}`),
  })

  const dateError = f.start_date && f.due_date && f.due_date < f.start_date

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Tasks are the smallest unit of work. Link them to a work package to roll progress up.</DialogDescription>
        </DialogHeader>
        <form id="new-task" className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); if (f.title.trim() && !dateError) create.mutate() }}>
          <Field label="Title" className="col-span-2"><Input autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="What needs to be done?" /></Field>
          <Field label="Description" className="col-span-2" hint="Markdown supported"><Textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label="Status">
            <OptionSelect value={f.status} onChange={(v) => set("status", (v ?? "todo") as Task["status"])}
              options={TASK_STATUSES.map((s) => ({ value: s.key, label: <span className="flex items-center gap-2"><StatusDot status={s.key} />{s.label}</span> }))} />
          </Field>
          <Field label="Priority"><OptionSelect value={f.priority} onChange={(v) => set("priority", v ?? "Medium")} options={PRIORITY_VALUES} /></Field>
          <Field label="Assignee" hint={!canAssignOthers ? "Without task management rights you can only assign tasks to yourself, unless the task belongs to a work package." : undefined}>
            <UserSelect value={f.assignee_id} onChange={(v) => set("assignee_id", v)} placeholder="Unassigned" />
          </Field>
          <Field label="Work package">
            <Combo value={f.work_package_id} onChange={(v) => set("work_package_id", v)} placeholder="None"
              items={(wps.data ?? []).map((w) => ({ value: w.id, label: `${w.code} ${w.title}`, hint: w.entity?.code ?? "Group" }))} />
          </Field>
          <Field label="Start date"><Input type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} /></Field>
          <Field label="Due date" hint={dateError ? <span className="text-alarm">The due date is before the start date.</span> : undefined}>
            <Input type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} aria-invalid={!!dateError} />
          </Field>
          <Field label="Estimate (hours)"><Input inputMode="decimal" value={f.estimate} onChange={(e) => set("estimate", e.target.value)} placeholder="e.g. 4" /></Field>
          <Field label="Labels"><LabelsInput value={f.labels} onChange={(v) => set("labels", v)} /></Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="submit" form="new-task" disabled={!f.title.trim() || !!dateError || create.isPending}>{create.isPending ? "Creating…" : "Create task"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
