import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { FileSearch, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Pill } from "@/components/common/basics"
import { api, ApiError } from "@/lib/api"

interface EvidenceCheckResult {
  model: string
  documents: { id: number; title: string; version: number }[]
  check_points: { point: string; verdict: "covered" | "partial" | "missing"; quote: string; document: string; comment: string }[] | null
  overall: string | null
  missing_elements: string[] | null
  summary: string | null
}

const TONE = { covered: "sage", partial: "amber", missing: "alarm" } as const

/** AI check whether the linked evidence covers the requirement's check points. Result is advisory only. */
export function EvidenceCheckButton({ answerId, canEdit, onUseAsNote, size = "sm" }: {
  answerId: number
  canEdit?: boolean
  onUseAsNote?: (text: string) => void
  size?: "sm" | "xs"
}) {
  const [open, setOpen] = useState(false)
  const run = useMutation({
    mutationFn: () => api.post<EvidenceCheckResult>(`/ai/assist/evidence-check/${answerId}`),
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 503) toast.error("The AI assistant is not configured yet.")
      else toast.error(e.message)
    },
  })
  const res = run.data
  const noteText = res ? [
    `AI evidence check (${res.model}, ${new Date().toLocaleDateString()}): overall ${res.overall ?? "–"}.`,
    ...(res.check_points ?? []).map((c) => `${c.point} ${c.verdict}${c.comment ? ` – ${c.comment}` : ""}`),
    ...(res.missing_elements?.length ? [`Missing: ${res.missing_elements.join("; ")}`] : []),
  ].join("\n") : ""

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v && !run.data && !run.isPending) run.mutate() }}>
      <DialogTrigger asChild>
        <Button size={size} variant="outline"><FileSearch /> Check evidence</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Evidence check</DialogTitle>
          <DialogDescription>
            The assistant compares the linked documents with the requirement's check points. It is a reviewer aid: verify the quotes before relying on the result.
          </DialogDescription>
        </DialogHeader>
        {run.isPending && <p className="flex items-center gap-2 text-[13px] text-ink-3"><Sparkles className="size-4 animate-pulse" /> Reading the documents…</p>}
        {run.error && <p className="text-[13px] text-alarm">{(run.error as Error).message}</p>}
        {res && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-ink-3">Overall</span>
              {res.overall && <Pill tone={TONE[res.overall as keyof typeof TONE] ?? "neutral"}>{res.overall}</Pill>}
              <span className="text-ink-3">based on {res.documents.map((d) => `${d.title} (v${d.version})`).join(", ")}</span>
            </div>
            {res.summary && <p className="text-[13.5px] text-ink-2">{res.summary}</p>}
            <ul className="divide-y rounded-md border">
              {(res.check_points ?? []).map((c) => (
                <li key={c.point} className="grid grid-cols-[48px_86px_1fr] gap-2 px-3 py-2 text-[13px]">
                  <span className="font-mono text-ink-3">{c.point}</span>
                  <span><Pill tone={TONE[c.verdict] ?? "neutral"}>{c.verdict}</Pill></span>
                  <span>
                    {c.quote && <span className="block text-ink-2 italic">“{c.quote}”{c.document && <span className="not-italic text-ink-3"> ({c.document})</span>}</span>}
                    {c.comment && <span className="block text-ink-3">{c.comment}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {res.missing_elements && res.missing_elements.length > 0 && (
              <div className="text-[13px]"><span className="font-medium">Missing:</span> {res.missing_elements.join("; ")}</div>
            )}
          </div>
        )}
        <DialogFooter>
          {res && <Button variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>Run again</Button>}
          {res && canEdit && onUseAsNote && (
            <Button onClick={() => { onUseAsNote(noteText); setOpen(false); toast.success("Added to the internal notes") }}>Add to internal notes</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
