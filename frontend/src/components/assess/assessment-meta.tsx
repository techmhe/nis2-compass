import { useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Field, OptionSelect, UserSelect } from "@/components/common/fields"
import { api } from "@/lib/api"
import { ASSESSMENT_STATUS } from "@/lib/constants"
import type { AssessmentListItem } from "@/lib/types"

type Meta = Pick<AssessmentListItem, "id" | "status" | "assessment_date" | "due_date" | "respondents" | "assessors" | "lead_user_id" | "summary" | "locked"> & {
  entity: { name: string; code: string }
}

const STATUS_OPTIONS = Object.entries(ASSESSMENT_STATUS).map(([value, label]) => ({ value, label }))

/** Edit assessment metadata. Status, lead, due date and lock need assessments.manage; the rest assessments.edit. */
export function AssessmentMetaDialog({ assessment, canManage, canEdit, trigger, roundName }: {
  assessment: Meta
  canManage: boolean
  canEdit: boolean
  trigger: ReactNode
  roundName?: string
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Meta>(assessment)
  const qc = useQueryClient()
  const set = <K extends keyof Meta>(k: K, v: Meta[K]) => setForm((f) => ({ ...f, [k]: v }))
  // a locked assessment can only be changed by managers
  const editable = canManage || (canEdit && !assessment.locked)

  const save = useMutation({
    mutationFn: () => {
      const keys = ["status", "assessment_date", "due_date", "respondents", "assessors", "lead_user_id", "summary", "locked"] as const
      const body: Record<string, unknown> = {}
      for (const k of keys) {
        const v = typeof form[k] === "string" && (form[k] as string).trim() === "" ? null : form[k]
        if (v !== assessment[k]) body[k] = v
      }
      if (!Object.keys(body).length) return Promise.resolve(null)
      return api.patch(`/assessments/${assessment.id}`, body)
    },
    onSuccess: (res) => {
      if (res) {
        toast.success("Assessment details saved")
        qc.invalidateQueries({ queryKey: ["assessments"] })
        qc.invalidateQueries({ queryKey: ["assessment", assessment.id] })
        qc.invalidateQueries({ queryKey: ["dash-gap"] })
      }
      setOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setForm(assessment) }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Assessment details: {assessment.entity.name}</DialogTitle>
          <DialogDescription>
            {roundName ? `${roundName}. ` : ""}
            {canManage ? "Status, lead, due date and lock can only be changed by assessment managers." : "Status, lead, due date and lock are set by assessment managers."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <OptionSelect value={form.status} onChange={(v) => set("status", v ?? "not_started")} options={STATUS_OPTIONS} disabled={!canManage} />
          </Field>
          <Field label="Lead assessor">
            <UserSelect value={form.lead_user_id} onChange={(v) => set("lead_user_id", v)} disabled={!canManage} placeholder="No lead" />
          </Field>
          <Field label="Assessment date" htmlFor="asm-date">
            <Input id="asm-date" type="date" value={form.assessment_date ?? ""} onChange={(e) => set("assessment_date", e.target.value || null)} disabled={!editable} />
          </Field>
          <Field label="Due date" htmlFor="asm-due">
            <Input id="asm-due" type="date" value={form.due_date ?? ""} onChange={(e) => set("due_date", e.target.value || null)} disabled={!canManage} />
          </Field>
          <Field label="Respondents" hint="Who answered, separated by semicolons" className="col-span-2" htmlFor="asm-resp">
            <Input id="asm-resp" value={form.respondents ?? ""} onChange={(e) => set("respondents", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Assessors" className="col-span-2" htmlFor="asm-assessors">
            <Input id="asm-assessors" value={form.assessors ?? ""} onChange={(e) => set("assessors", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Summary" className="col-span-2" htmlFor="asm-summary">
            <Textarea id="asm-summary" rows={3} value={form.summary ?? ""} onChange={(e) => set("summary", e.target.value)} disabled={!editable}
              placeholder="Overall result, main gaps and next steps" />
          </Field>
          <label className="col-span-2 flex items-center justify-between gap-3 rounded-md border bg-surface px-3 py-2">
            <span>
              <span className="block text-[13px] font-medium text-ink">Lock assessment</span>
              <span className="block text-[12px] text-ink-3">Locked answers can only be changed by assessment managers.</span>
            </span>
            <Switch checked={form.locked} onCheckedChange={(v) => set("locked", v)} disabled={!canManage} aria-label="Lock assessment" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!editable || save.isPending} onClick={() => save.mutate()}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
