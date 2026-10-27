import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"

interface ImportRow { row: number; kpi: string; entity: string; period: string; value?: number; ok: boolean; error?: string }
interface ImportResult { dry_run: boolean; valid: number; invalid: number; rows: ImportRow[] }

/** CSV import of KPI values (e.g. from a script reading Entra ID, Intune, Defender or the backup software). */
export function KpiImportDialog() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const run = useMutation({
    mutationFn: (dryRun: boolean) => {
      const fd = new FormData()
      fd.append("file", file!)
      return api.upload<ImportResult>("/controls/kpis/import", fd, { dry_run: dryRun })
    },
    onSuccess: (r) => {
      setResult(r)
      if (!r.dry_run) {
        toast.success(`${r.valid} KPI value${r.valid === 1 ? "" : "s"} imported`)
        qc.invalidateQueries({ queryKey: ["controls", "kpis"] })
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setFile(null); setResult(null) } }}>
      <DialogTrigger asChild><Button variant="outline"><Upload /> Import values</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import KPI values</DialogTitle>
          <DialogDescription>
            CSV with the columns <code className="font-mono">kpi_code, entity_code, period, value, note</code> (comma or semicolon separated;
            entity_code "group" for group-wide KPIs; period as shown in data entry, e.g. 2026-Q3 or 2026-09). Scripts can upload the same file
            with an API token. Every row is checked first; nothing is stored until you import.
          </DialogDescription>
        </DialogHeader>
        <Input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null) }} />
        {result && (
          <div className="space-y-2">
            <p className="text-[13px]">{result.valid} valid, <span className={result.invalid ? "text-alarm" : undefined}>{result.invalid} with errors</span>{result.dry_run ? " (check only)" : ""}.</p>
            {result.rows.some((r) => !r.ok) && (
              <ul className="max-h-60 divide-y overflow-y-auto rounded-md border text-[12.5px]">
                {result.rows.filter((r) => !r.ok).map((r) => (
                  <li key={r.row} className="flex gap-3 px-3 py-1.5"><span className="tabular text-ink-3">Row {r.row}</span><span className="font-mono">{r.kpi} {r.entity} {r.period}</span><span className="text-alarm">{r.error}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={!file || run.isPending} onClick={() => run.mutate(true)}>Check file</Button>
          <Button disabled={!file || run.isPending || !result?.dry_run || result.valid === 0} onClick={() => run.mutate(false)}>
            Import {result?.dry_run ? result.valid : ""} values
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
