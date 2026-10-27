import { useRef, useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FileSpreadsheet } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Code, ErrorState, Pill, Stat } from "@/components/common/basics"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { type Finding, RatingPill, SeverityPill, supplierKey } from "./shared"

interface ImportRow { row: number; id: string; answer: string | null; comment: string | null; status: string; message: string | null }
interface ImportResult {
  rows: ImportRow[]
  missing: string[]
  answered: number
  questions: number
  score: number | null
  rating: string | null
  findings: Finding[]
  dry_run: boolean
  template: { id: number; tier: string; version: number; title: string }
  assessment_id: number | null
}

const STATUS_TONE: Record<string, string> = { ok: "sage", unanswered: "amber", invalid: "alarm", unknown: "alarm", duplicate: "amber" }
const STATUS_LABEL: Record<string, string> = { ok: "Read", unanswered: "No answer", invalid: "Invalid", unknown: "Unknown ID", duplicate: "Duplicate" }

export function QuestionnaireImportDialog({ supplierId, open, onOpenChange }: { supplierId: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const run = useMutation({
    mutationFn: (dryRun: boolean) => {
      const fd = new FormData()
      fd.append("file", file!)
      return api.upload<ImportResult>(`/suppliers/${supplierId}/questionnaire/import`, fd, { dry_run: dryRun })
    },
    onSuccess: (r) => {
      if (r.dry_run) { setResult(r); return }
      toast.success("Assessment created from the questionnaire")
      qc.invalidateQueries({ queryKey: supplierKey(supplierId) })
      qc.invalidateQueries({ queryKey: ["suppliers", "list"] })
      close(false)
    },
  })
  const close = (v: boolean) => { onOpenChange(v); if (!v) { setFile(null); setResult(null); run.reset() } }
  const choose = (f: File | null) => { setFile(f); setResult(null); run.reset() }
  const problems = result?.rows.filter((r) => r.status !== "ok") ?? []

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import questionnaire answers</DialogTitle>
          <DialogDescription>
            Upload the workbook the supplier returned. The file is checked first; nothing is saved until you create the assessment.
          </DialogDescription>
        </DialogHeader>
        <button type="button" onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); choose(e.dataTransfer.files?.[0] ?? null) }}
          className="flex w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted/40 px-4 py-6 text-center hover:bg-muted">
          <FileSpreadsheet className="size-5 text-ink-3" />
          <span className="text-[13px] text-ink">{file ? file.name : "Drop the .xlsx file here or click to choose"}</span>
          <span className="text-[11.5px] text-ink-3">Only workbooks downloaded for this supplier are accepted</span>
        </button>
        <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        {run.error && <ErrorState error={run.error} />}
        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 rounded-md border bg-surface px-4 py-3">
              <Stat label="Score" value={result.score != null ? `${Math.round(result.score)}%` : "–"} hint={<RatingPill rating={result.rating} />} />
              <Stat label="Answered" value={`${result.answered} of ${result.questions}`} tone={result.answered < result.questions ? "amber" : undefined} />
              <Stat label="Findings" value={result.findings.length} tone={result.findings.length ? "alarm" : undefined} hint="No or partial answers" />
            </div>
            <p className="text-[12.5px] text-ink-3">{result.template.title}, version {result.template.version}.</p>
            {problems.length > 0 && (
              <div>
                <div className="mb-1.5 text-[12.5px] font-medium text-ink-2">Rows that need attention</div>
                <div className="max-h-48 overflow-auto rounded-md border scroll-thin">
                  <table className="w-full text-[12.5px]">
                    <tbody>
                      {problems.map((r) => (
                        <tr key={`${r.row}-${r.id}`} className="border-b last:border-0">
                          <td className="tabular w-16 px-3 py-1.5 text-ink-3">Row {r.row}</td>
                          <td className="w-14 px-2 py-1.5"><Code>{r.id}</Code></td>
                          <td className="w-28 px-2 py-1.5"><Pill tone={STATUS_TONE[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Pill></td>
                          <td className="px-2 py-1.5 text-ink-2">{r.message}{r.answer && r.status === "invalid" && <span className="text-ink-3"> (“{r.answer}”)</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {result.missing.length > 0 && (
              <p className="text-[12.5px] text-amber">Missing from the file: {result.missing.join(", ")}</p>
            )}
            {result.findings.length > 0 && (
              <div>
                <div className="mb-1.5 text-[12.5px] font-medium text-ink-2">Findings to be recorded</div>
                <ul className="max-h-48 space-y-1 overflow-auto scroll-thin">
                  {result.findings.map((f, i) => (
                    <li key={i} className={cn("flex items-start gap-2 rounded-md border bg-card px-2.5 py-1.5 text-[12.5px]")}>
                      <SeverityPill severity={f.severity} /><span className="text-ink-2">{f.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          {!result ? (
            <Button disabled={!file || run.isPending} onClick={() => run.mutate(true)}>{run.isPending ? "Checking…" : "Check file"}</Button>
          ) : (
            <Button disabled={run.isPending || result.answered === 0} onClick={() => run.mutate(false)}>{run.isPending ? "Creating…" : "Create assessment"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type { ReactNode }
