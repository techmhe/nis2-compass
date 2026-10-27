import { useState, type ReactNode } from "react"
import { Link } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarRange, ClipboardCheck, Link2, ListChecks, MoreHorizontal, PackageCheck, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Code, EntityTag, ErrorState, Loading, Meter } from "@/components/common/basics"
import { CommentsPanel, DocumentLinks, Markdown } from "@/components/common/collab"
import { Combo, OptionSelect, UserSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useUsers } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { PRIORITY_VALUES, TASK_STATUSES } from "@/lib/constants"
import { fmtDateTime, fromNow } from "@/lib/format"
import type { Task } from "@/lib/types"
import { cn } from "@/lib/utils"
import { DateField, invalidateTaskViews, LabelsInput, StatusDot, useTaskParam, useTaskPatch, useWorkPackageOptions, type TaskDetail, type TaskPatch } from "./common"

/** Task detail drawer. Mount once per page; it opens whenever the URL contains ?task=<id>. */
export function TaskDrawer() {
  const [taskId, setTaskId] = useTaskParam()
  // keep rendering the last task while the sheet animates closed
  const [shownId, setShownId] = useState(taskId)
  if (taskId != null && taskId !== shownId) setShownId(taskId)
  return (
    <Sheet open={taskId != null} onOpenChange={(v) => { if (!v) setTaskId(null) }}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[680px]" aria-describedby={undefined}>
        {shownId != null && <TaskDrawerBody key={shownId} taskId={shownId} onClose={() => setTaskId(null)} />}
      </SheetContent>
    </Sheet>
  )
}

function TaskDrawerBody({ taskId, onClose }: { taskId: number; onClose: () => void }) {
  const qc = useQueryClient()
  const { me, can } = useAuth()
  const users = useUsers()
  const wps = useWorkPackageOptions()
  const q = useQuery({ queryKey: ["task", taskId], queryFn: () => api.get<TaskDetail>(`/tasks/${taskId}`) })
  const patch = useTaskPatch()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const del = useMutation({
    mutationFn: () => api.del(`/tasks/${taskId}`),
    onSuccess: () => {
      toast.success(`Deleted ${q.data?.task.key ?? "task"}`)
      qc.removeQueries({ queryKey: ["task", taskId] })
      invalidateTaskViews(qc)
      onClose()
    },
    onError: (e: Error) => toast.error(`Could not delete the task: ${e.message}`),
  })

  if (q.isLoading) return <><SheetTitle className="sr-only">Task</SheetTitle><Loading className="p-6" /></>
  if (q.error || !q.data) return (
    <div className="p-6">
      <SheetTitle className="mb-3">Task</SheetTitle>
      <ErrorState error={q.error ?? "Task not found"} />
    </div>
  )

  const { task: t, documents, can_edit: canEdit, links } = q.data
  const canDelete = t.reporter?.id === me?.id || can("tasks.manage", t.entity?.id ?? null)
  const save = (p: TaskPatch, optimistic?: Partial<Task>) => patch.mutate({ id: t.id, patch: p, optimistic })
  const checklistDone = t.checklist.filter((c) => c.done).length
  const copyLink = () => {
    const url = `${window.location.origin}/tasks?task=${t.id}`
    navigator.clipboard.writeText(url).then(() => toast.success("Link copied"), () => toast.error("Could not copy the link"))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b bg-background px-5 py-3 pr-12">
        <Code className="text-[13px]">{t.key}</Code>
        {t.work_package && (
          <Link to={`/work-packages/${t.work_package.id}`} className="inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-petrol">
            <PackageCheck className="size-3.5" /><Code className="text-[12px]">{t.work_package.code}</Code>
          </Link>
        )}
        {t.entity && <EntityTag code={t.entity.code} name={t.entity.name} />}
        {t.overdue && <span className="text-[12px] font-medium text-alarm">Overdue</span>}
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="More actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={copyLink}><Link2 /> Copy link</DropdownMenuItem>
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-alarm focus:text-alarm" onSelect={() => setConfirmDelete(true)}><Trash2 /> Delete task</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4 scroll-thin">
        <div>
          <SheetTitle className="sr-only">{t.key} {t.title}</SheetTitle>
          <SheetDescription className="sr-only">Task details</SheetDescription>
          <InlineTitle value={t.title} disabled={!canEdit} onSave={(title) => save({ title })} />
          {!canEdit && <p className="mt-1 text-[12.5px] text-ink-3">You can view this task but not edit it. Only the assignee, the reporter or task managers can make changes.</p>}
        </div>

        <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-[110px_minmax(0,1fr)_110px_minmax(0,1fr)]">
          <PropLabel>Status</PropLabel>
          <OptionSelect size="sm" value={t.status} disabled={!canEdit} onChange={(v) => v && v !== t.status && save({ status: v as Task["status"] })}
            options={TASK_STATUSES.map((s) => ({ value: s.key, label: <span className="flex items-center gap-2"><StatusDot status={s.key} />{s.label}</span> }))} />
          <PropLabel>Priority</PropLabel>
          <OptionSelect size="sm" value={t.priority} disabled={!canEdit} onChange={(v) => v && v !== t.priority && save({ priority: v })} options={PRIORITY_VALUES} />
          <PropLabel>Assignee</PropLabel>
          <UserSelect value={t.assignee?.id ?? null} disabled={!canEdit} className="h-8" placeholder="Unassigned"
            onChange={(v) => {
              const u = users.data?.find((x) => x.id === v)
              save({ assignee_id: v }, { assignee: u ? { id: u.id, display_name: u.display_name, email: u.email } : null })
            }} />
          <PropLabel>Work package</PropLabel>
          <Combo value={t.work_package?.id ?? null} disabled={!canEdit} className="h-8" placeholder="None"
            items={(wps.data ?? []).map((w) => ({ value: w.id, label: `${w.code} ${w.title}`, hint: w.entity?.code ?? "Group" }))}
            onChange={(v) => {
              const w = wps.data?.find((x) => x.id === v)
              save({ work_package_id: v }, { work_package: w ? { id: w.id, code: w.code, title: w.title } : null })
            }} />
          <PropLabel>Start date</PropLabel>
          <DateField label="Start date" value={t.start_date} disabled={!canEdit} onCommit={(v) => save({ start_date: v })} />
          <PropLabel>Due date</PropLabel>
          <DateField label="Due date" value={t.due_date} disabled={!canEdit} onCommit={(v) => save({ due_date: v })}
            className={cn(t.overdue && "border-alarm/50 text-alarm")} />
          <PropLabel>Estimate</PropLabel>
          <EstimateField value={t.estimate_hours} disabled={!canEdit} onCommit={(v) => save({ estimate_hours: v })} />
          <PropLabel>Labels</PropLabel>
          <LabelsInput value={t.labels} disabled={!canEdit} onChange={(labels) => save({ labels })} />
        </div>

        <DescriptionBlock value={t.description} disabled={!canEdit} onSave={(description) => save({ description })} />

        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-[13.5px] font-semibold">Checklist</h3>
            {t.checklist.length > 0 && <span className="tabular text-[12px] text-ink-3">{checklistDone} of {t.checklist.length} done</span>}
          </div>
          {t.checklist.length > 0 && <Meter value={checklistDone / t.checklist.length} className="mb-2" />}
          <Checklist items={t.checklist} disabled={!canEdit} onChange={(checklist) => save({ checklist })} />
        </section>

        <section>
          <h3 className="mb-2 text-[13.5px] font-semibold">Linked to</h3>
          <TaskLinksList task={t} links={links} />
        </section>

        <section>
          <h3 className="mb-2 text-[13.5px] font-semibold">Documents</h3>
          <DocumentLinks targetType="task" targetId={t.id} documents={documents} entityId={t.entity?.id ?? null} canEdit={canEdit}
            onChange={() => qc.invalidateQueries({ queryKey: ["task", t.id] })} compact />
        </section>

        <section>
          <h3 className="mb-2 text-[13.5px] font-semibold">Comments</h3>
          <CommentsPanel targetType="task" targetId={t.id} />
        </section>

        <p className="border-t pt-3 text-[12px] text-ink-3">
          Created {fromNow(t.created_at)}{t.reporter ? ` by ${t.reporter.display_name}` : ""}. Last updated {fromNow(t.updated_at)}.
          {t.completed_at && ` Completed ${fmtDateTime(t.completed_at)}.`}
        </p>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {t.key}?</AlertDialogTitle>
            <AlertDialogDescription>The task, its checklist and comments are removed permanently.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-alarm hover:bg-alarm/90" onClick={() => del.mutate()}>Delete task</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function PropLabel({ children }: { children: string }) {
  return <span className="text-[12.5px] text-ink-3">{children}</span>
}

function InlineTitle({ value, onSave, disabled }: { value: string; onSave: (v: string) => void; disabled: boolean }) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  if (seen !== value) { setSeen(value); setText(value) }
  const commit = () => {
    const v = text.trim()
    if (!v) { setText(value); toast.error("A task needs a title"); return }
    if (v !== value) onSave(v)
  }
  if (disabled) return <h2 className="text-[18px] leading-snug font-semibold text-ink">{value}</h2>
  return (
    <Textarea value={text} rows={1} aria-label="Task title" onChange={(e) => setText(e.target.value.replace(/\n/g, " "))} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() }
        if (e.key === "Escape") { setText(value) }
      }}
      className="min-h-0 resize-none border-transparent px-1.5 py-1 text-[18px] leading-snug font-semibold shadow-none field-sizing-content hover:border-border focus-visible:border-input" />
  )
}

function EstimateField({ value, onCommit, disabled }: { value: number | null; onCommit: (v: number | null) => void; disabled: boolean }) {
  const [text, setText] = useState(value != null ? String(value) : "")
  const [seen, setSeen] = useState(value)
  if (seen !== value) { setSeen(value); setText(value != null ? String(value) : "") }
  const commit = () => {
    if (text.trim() === "") { if (value != null) onCommit(null); return }
    const n = Number(text.replace(",", "."))
    if (!Number.isFinite(n) || n < 0 || n > 10000) { toast.error("Enter the estimate in hours between 0 and 10000"); setText(value != null ? String(value) : ""); return }
    if (n !== value) onCommit(n)
  }
  return (
    <div className="flex items-center gap-1.5">
      <Input inputMode="decimal" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()} className="h-8 w-24" aria-label="Estimate in hours" placeholder="–" />
      <span className="text-[12.5px] text-ink-3">hours</span>
    </div>
  )
}

function DescriptionBlock({ value, onSave, disabled }: { value: string | null; onSave: (v: string | null) => void; disabled: boolean }) {
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState<"write" | "preview">("write")
  const [text, setText] = useState(value ?? "")
  const start = () => { setText(value ?? ""); setMode("write"); setEditing(true) }
  const commit = () => { onSave(text.trim() ? text : null); setEditing(false) }
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[13.5px] font-semibold">Description</h3>
        {editing && (
          <div role="tablist" className="ml-2 inline-flex rounded-md border bg-surface p-0.5 text-[12px]">
            {(["write", "preview"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                className={cn("h-6 rounded-[4px] px-2 font-medium", mode === m ? "bg-muted text-ink" : "text-ink-3 hover:text-ink")}>
                {m === "write" ? "Write" : "Preview"}
              </button>
            ))}
          </div>
        )}
        {!editing && !disabled && <Button size="xs" variant="ghost" className="ml-auto" onClick={start}>Edit description</Button>}
      </div>
      {editing ? (
        <div className="space-y-2">
          {mode === "write" ? (
            <Textarea autoFocus rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe the task. Markdown is supported."
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit(); if (e.key === "Escape") setEditing(false) }} />
          ) : (
            <div className="min-h-[120px] rounded-md border bg-surface px-3 py-2">
              {text.trim() ? <Markdown className="prose-md text-[13.5px]">{text}</Markdown> : <p className="text-[13px] text-ink-3">Nothing to preview.</p>}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-[12px] text-ink-3">Markdown supported. Ctrl+Enter saves.</span>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" onClick={commit}>Save description</Button>
          </div>
        </div>
      ) : value ? (
        <div className={cn("rounded-md px-1", !disabled && "cursor-text hover:bg-muted/50")} onDoubleClick={() => !disabled && start()}>
          <Markdown className="prose-md text-[13.5px]">{value}</Markdown>
        </div>
      ) : (
        <p className="text-[13px] text-ink-3">{disabled ? "No description." : "No description yet. Use Edit description to add context, acceptance notes or links."}</p>
      )}
    </section>
  )
}

function Checklist({ items, onChange, disabled }: { items: { text: string; done: boolean }[]; onChange: (v: { text: string; done: boolean }[]) => void; disabled: boolean }) {
  const [text, setText] = useState("")
  const add = () => {
    const v = text.trim()
    if (!v) return
    onChange([...items, { text: v, done: false }])
    setText("")
  }
  return (
    <div className="space-y-1">
      {items.length === 0 && disabled && <p className="text-[13px] text-ink-3">No checklist items.</p>}
      <ul className="space-y-0.5">
        {items.map((c, i) => (
          <li key={i} className="group flex items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-muted/60">
            <Checkbox checked={c.done} disabled={disabled} aria-label={`Mark "${c.text}" as ${c.done ? "not done" : "done"}`}
              onCheckedChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, done: v === true } : x)))} />
            <span className={cn("flex-1 text-[13px]", c.done ? "text-ink-3 line-through" : "text-ink")}>{c.text}</span>
            {!disabled && (
              <button className="text-ink-3 opacity-0 group-hover:opacity-100 hover:text-alarm focus-visible:opacity-100" aria-label={`Remove "${c.text}"`}
                onClick={() => onChange(items.filter((_, j) => j !== i))}><X className="size-3.5" /></button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <form className="flex items-center gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); add() }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a checklist item" className="h-8" aria-label="New checklist item" />
          <Button size="sm" variant="outline" type="submit" disabled={!text.trim()}><Plus /> Add item</Button>
        </form>
      )}
    </div>
  )
}

function TaskLinksList({ task: t, links }: { task: Task; links?: TaskDetail["links"] }) {
  const rows: { icon: ReactNode; label: ReactNode; to: string | null }[] = []
  if (t.work_package) rows.push({ icon: <PackageCheck />, to: `/work-packages/${t.work_package.id}`, label: <><Code>{t.work_package.code}</Code> {t.work_package.title}</> })
  if (t.action_item_id) {
    const ai = links?.action_item
    rows.push({ icon: <ListChecks />, to: `/action-plan?item=${t.action_item_id}`, label: ai ? <><Code>{ai.code}</Code> {ai.title} <EntityTag code={ai.entity_code} /></> : "Action plan item" })
  }
  if (t.answer_id) {
    const a = links?.answer
    rows.push({
      icon: <ClipboardCheck />,
      to: a ? `/assessments/${a.assessment_id}?req=${a.requirement_id}` : null,
      label: a ? <>Requirement <Code>{a.number}</Code> {a.section} <EntityTag code={a.entity_code} /></> : "Assessment answer (no access)",
    })
  }
  if (t.activity_id) {
    const act = links?.activity
    rows.push({ icon: <CalendarRange />, to: act ? `/projects/${act.project_id}/plan?activity=${act.id}` : null, label: act ? <><Code>{act.code}</Code> {act.title}</> : "Master plan activity" })
  }
  if (rows.length === 0) return <p className="text-[13px] text-ink-3">Not linked to a work package, finding, requirement or activity. Choose a work package above to link it.</p>
  return (
    <ul className="space-y-1">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-[13px] [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-ink-3">
          {r.icon}
          {r.to ? <Link to={r.to} className="flex min-w-0 flex-1 items-center gap-1.5 truncate hover:text-petrol">{r.label}</Link> : <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-ink-2">{r.label}</span>}
        </li>
      ))}
    </ul>
  )
}
