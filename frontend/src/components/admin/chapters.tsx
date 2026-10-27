import { useState } from "react"
import { Link } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, ErrorState, Loading, Section } from "@/components/common/basics"
import { Field } from "@/components/common/fields"
import { api } from "@/lib/api"
import { fmtDateTime, pct } from "@/lib/format"
import type { Chapter } from "@/lib/types"
import { DataTable, TD, TH } from "./common"

interface TargetChange { id: number; chapter: string; old_target: number; new_target: number; reason: string; changed_at: string; changed_by: string | null }

export function ChaptersSection() {
  const chapters = useQuery({ queryKey: ["chapters"], queryFn: () => api.get<Chapter[]>("/chapters") })
  const history = useQuery({ queryKey: ["chapters", "target-history"], queryFn: () => api.get<TargetChange[]>("/chapters/target-history") })
  const [editing, setEditing] = useState<Chapter | null>(null)

  return (
    <div className="space-y-5">
      {chapters.isLoading ? <Loading /> : chapters.error ? <ErrorState error={chapters.error} /> : (
        <DataTable minWidth={760}>
          <thead>
            <tr className="border-b">
              <th className={`${TH} w-12`}>No.</th>
              <th className={TH}>Chapter</th>
              <th className={TH}>Source</th>
              <th className={`${TH} text-right`}>Requirements</th>
              <th className={`${TH} w-[200px]`}>Target</th>
              <th className={TH}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {(chapters.data ?? []).map((c) => (
              <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className={TD}><Code>{c.number}</Code></td>
                <td className={TD}><Link to={`/catalog?chapter=${c.number}`} className="text-ink hover:text-petrol">{c.title}</Link></td>
                <td className={`${TD} text-[12.5px] text-ink-3`}>{c.source}</td>
                <td className={`${TD} tabular text-right text-ink-2`}>{c.requirement_count}</td>
                <td className={TD}>
                  <div className="flex items-center gap-2">
                    <div className="relative h-1.5 flex-1 rounded-full bg-muted">
                      <div className="absolute -top-1 h-3.5 w-[2px] rounded bg-brass" style={{ left: `calc(${c.target * 100}% - 1px)` }} />
                    </div>
                    <span className="tabular w-10 text-right font-medium text-brass">{pct(c.target)}</span>
                  </div>
                </td>
                <td className={`${TD} text-right`}>
                  <Button size="xs" variant="outline" onClick={() => setEditing(c)}>Change target</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <Section title="Change history" bodyClassName="p-0">
        {history.isLoading ? <Loading /> : history.error ? <ErrorState error={history.error} className="m-4" /> : !history.data?.length ? (
          <Empty title="No target changes yet" className="py-6">Changes made here are listed with the reason and who made them.</Empty>
        ) : (
          <ul className="divide-y">
            {history.data.map((h) => (
              <li key={h.id} className="px-4 py-2.5 text-[13px]">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-ink">{h.chapter}</span>
                  <span className="tabular text-ink-2">{pct(h.old_target)} to <span className="font-medium text-brass">{pct(h.new_target)}</span></span>
                  <span className="ml-auto text-[12px] text-ink-3">{h.changed_by ?? "Unknown"}, {fmtDateTime(h.changed_at)}</span>
                </div>
                <p className="mt-0.5 text-ink-2">{h.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {editing && <TargetDialog chapter={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function TargetDialog({ chapter, onClose }: { chapter: Chapter; onClose: () => void }) {
  const qc = useQueryClient()
  const [value, setValue] = useState(String(Math.round(chapter.target * 100)))
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const n = Number(value)
  const valid = value !== "" && Number.isFinite(n) && n >= 0 && n <= 100
  const save = useMutation({
    mutationFn: () => api.post(`/chapters/${chapter.id}/target`, { target: n / 100, reason: reason.trim() }),
    onMutate: () => setError(null),
    onSuccess: () => {
      toast.success(`Target of chapter ${chapter.number} set to ${n}%`)
      qc.invalidateQueries({ queryKey: ["chapters"] })
      qc.invalidateQueries({ queryKey: ["dash-gap"] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change target of chapter {chapter.number}</DialogTitle>
          <DialogDescription>{chapter.title}. The current target is {pct(chapter.target)}. Scores are compared against the new target everywhere.</DialogDescription>
        </DialogHeader>
        <form id="target-form" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <Field label="New target (%)" htmlFor="t-value">
            <Input id="t-value" type="number" min={0} max={100} step={5} value={value} onChange={(e) => setValue(e.target.value)} className="w-32" />
          </Field>
          <Field label="Reason" htmlFor="t-reason" hint="Required. Recorded in the change history and the audit log.">
            <Textarea id="t-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Decision of the steering committee of 12 March" />
          </Field>
          {error && <ErrorState error={error} />}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="target-form" disabled={!valid || reason.trim().length < 3 || save.isPending || n / 100 === chapter.target}>Change target</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
