import { useState } from "react"
import { Link } from "react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Diamond, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, ErrorState, Loading, StatusPill } from "@/components/common/basics"
import { CommentsPanel, Confirm } from "@/components/common/collab"
import { Field, OptionSelect, StakeholderSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { PROJECT_STATUS } from "@/lib/constants"
import { fmtDate } from "@/lib/format"
import type { Gate } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ACTIVITY_DEPENDENT, daysLabel, daysUntil, nn, useGates } from "./shared"

export function ProjectGates({ projectId }: { projectId: number }) {
  const { canGlobal } = useAuth()
  const canManage = canGlobal("projects.manage")
  const gates = useGates(projectId)
  const [editing, setEditing] = useState<Gate | "new" | null>(null)

  if (gates.isLoading) return <Loading />
  if (gates.error) return <ErrorState error={gates.error} />
  const rows = gates.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-ink-3">Management decision points. A gate is ready when all activities assigned to it are completed.</p>
        {canManage && <Button onClick={() => setEditing("new")}><Plus /> New gate</Button>}
      </div>
      <div data-tour="project.gates" className="overflow-x-auto rounded-md border bg-card scroll-thin">
        {rows.length === 0 ? (
          <Empty title="No gates defined">{canManage ? "Create gates for the key management decisions of the project." : "The project manager has not defined gates yet."}</Empty>
        ) : (
          <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-3 [&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th className="w-[92px]">Gate</th>
                <th className="w-[120px]">Planned date</th>
                <th className="min-w-[220px]">Decision</th>
                <th className="w-[150px]">Decision owner</th>
                <th className="min-w-[180px]">Required input</th>
                <th className="min-w-[180px]">Approval criterion</th>
                <th className="w-[110px]">Status</th>
                <th className="w-[130px]">Decision reference</th>
                <th className="w-[100px]">Activities</th>
                {canManage && <th className="w-[44px]" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const days = daysUntil(g.planned_date)
                const late = days != null && days < 0 && g.status !== "Completed"
                return (
                  <tr key={g.id} className="align-top hover:bg-muted/40 [&>td]:border-b [&>td]:px-3 [&>td]:py-2.5">
                    <td>
                      <span className="inline-flex items-center gap-1.5">
                        <Diamond className={cn("size-3.5 text-brass", g.status === "Completed" && "fill-brass")} aria-hidden />
                        <Code className="text-ink">{g.code}</Code>
                      </span>
                    </td>
                    <td>
                      <div className="tabular text-ink">{fmtDate(g.planned_date)}</div>
                      {g.actual_date ? <div className="tabular text-[12px] text-ink-3">Decided {fmtDate(g.actual_date)}</div>
                        : g.status !== "Completed" && <div className={cn("tabular text-[12px]", late ? "font-medium text-alarm" : days != null && days <= 30 ? "text-amber" : "text-ink-3")}>{daysLabel(days)}</div>}
                    </td>
                    <td className="text-ink">{g.decision ?? <span className="text-ink-3">–</span>}</td>
                    <td className="text-ink-2">{g.decision_owner?.name ?? <span className="text-ink-3">–</span>}</td>
                    <td className="text-[12.5px] text-ink-2">{g.required_input ?? "–"}</td>
                    <td className="text-[12.5px] text-ink-2">{g.approval_criterion ?? "–"}</td>
                    <td><StatusPill value={g.status} /></td>
                    <td className="text-[12.5px] text-ink-2">{g.decision_reference ?? <span className="text-ink-3">–</span>}</td>
                    <td>
                      {g.activities === 0 ? <span className="text-ink-3">None</span> : (
                        <Link to={`/projects/${projectId}/plan?gate=${g.id}`} className="text-petrol hover:underline">
                          <span className="tabular">{g.open_activities}</span> open of <span className="tabular">{g.activities}</span>
                        </Link>
                      )}
                    </td>
                    {canManage && (
                      <td><Button size="icon-sm" variant="ghost" aria-label={`Edit ${g.code}`} onClick={() => setEditing(g)}><Pencil /></Button></td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {canManage && (
        <GateDialog projectId={projectId} gate={editing === "new" ? null : editing} open={editing != null}
          onOpenChange={(v) => !v && setEditing(null)} nextOrder={rows.length} />
      )}
    </div>
  )
}

function GateDialog({ projectId, gate, open, onOpenChange, nextOrder }: {
  projectId: number; gate: Gate | null; open: boolean; onOpenChange: (v: boolean) => void; nextOrder: number
}) {
  const qc = useQueryClient()
  const init = () => ({
    code: gate?.code ?? `Gate ${nextOrder + 1}`, planned_date: gate?.planned_date ?? "", actual_date: gate?.actual_date ?? "",
    decision: gate?.decision ?? "", decision_owner_id: gate?.decision_owner?.id ?? null, required_input: gate?.required_input ?? "",
    approval_criterion: gate?.approval_criterion ?? "", status: gate?.status ?? "Not Started", decision_reference: gate?.decision_reference ?? "",
    sort_order: gate?.sort_order ?? nextOrder,
  })
  const [f, setF] = useState(init)
  const [key, setKey] = useState("")
  const k = open ? String(gate?.id ?? "new") : ""
  if (k !== key) { setKey(k); if (open) setF(init()) }
  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) => setF((p) => ({ ...p, [k]: v }))
  const invalidate = () => ACTIVITY_DEPENDENT.forEach((x) => qc.invalidateQueries({ queryKey: [x] }))

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: f.code.trim(), planned_date: nn(f.planned_date), actual_date: nn(f.actual_date), decision: nn(f.decision.trim()),
        decision_owner_id: f.decision_owner_id, required_input: nn(f.required_input.trim()), approval_criterion: nn(f.approval_criterion.trim()),
        status: f.status, decision_reference: nn(f.decision_reference.trim()), sort_order: f.sort_order,
      }
      return gate ? api.put<Gate>(`/projects/gates/${gate.id}`, body) : api.post<Gate>(`/projects/${projectId}/gates`, body)
    },
    onSuccess: (g) => { toast.success(gate ? `Saved ${g.code}` : `Created ${g.code}`); invalidate(); onOpenChange(false) },
    onError: (e: Error) => toast.error(`Could not save the gate: ${e.message}`),
  })
  const del = useMutation({
    mutationFn: () => api.del(`/projects/gates/${gate!.id}`),
    onSuccess: () => { toast.success(`Deleted ${gate!.code}`); invalidate(); onOpenChange(false) },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{gate ? `Edit ${gate.code}` : "New gate"}</DialogTitle>
          <DialogDescription>Record the decision, who takes it and on what basis.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Gate"><Input value={f.code} onChange={(e) => set("code", e.target.value)} className="font-mono" /></Field>
          <Field label="Status"><OptionSelect value={f.status} onChange={(v) => set("status", v ?? "Not Started")} options={PROJECT_STATUS} /></Field>
          <Field label="Planned date"><Input type="date" value={f.planned_date} onChange={(e) => set("planned_date", e.target.value)} /></Field>
          <Field label="Actual decision date"><Input type="date" value={f.actual_date} onChange={(e) => set("actual_date", e.target.value)} /></Field>
          <Field label="Decision" className="col-span-2"><Textarea rows={2} value={f.decision} onChange={(e) => set("decision", e.target.value)} /></Field>
          <Field label="Decision owner"><StakeholderSelect value={f.decision_owner_id} onChange={(v) => set("decision_owner_id", v)} placeholder="Select owner…" /></Field>
          <Field label="Decision reference" hint="Minutes, resolution number or document"><Input value={f.decision_reference} onChange={(e) => set("decision_reference", e.target.value)} /></Field>
          <Field label="Required input" className="col-span-2"><Textarea rows={2} value={f.required_input} onChange={(e) => set("required_input", e.target.value)} /></Field>
          <Field label="Approval criterion" className="col-span-2"><Textarea rows={2} value={f.approval_criterion} onChange={(e) => set("approval_criterion", e.target.value)} /></Field>
        </div>
        {gate && (
          <div className="border-t pt-3">
            <h3 className="mb-2 text-[13.5px] font-semibold">Comments</h3>
            <CommentsPanel targetType="gate" targetId={gate.id} />
          </div>
        )}
        <DialogFooter>
          {gate && (
            <Confirm title={`Delete ${gate.code}?`} description="Activities assigned to this gate keep their dates but lose the gate link."
              trigger={<Button variant="ghost" className="mr-auto text-alarm hover:text-alarm"><Trash2 /> Delete gate</Button>} onConfirm={() => del.mutate()} />
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!f.code.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : gate ? "Save changes" : "Create gate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
