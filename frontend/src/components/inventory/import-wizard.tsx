import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FileSpreadsheet, Paperclip } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Pill, Stat } from "@/components/common/basics"
import { OptionSelect, Segmented } from "@/components/common/fields"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useInventoryMeta } from "./shared"

type Kind = "assets" | "services"

interface Preview {
  filename: string; sheets: string[]; sheet: string; columns: string[]; row_count: number; sample: string[][]
  suggested: Record<Kind, Record<string, string | null>>
}

interface ImportResult {
  dry_run: boolean; kind: Kind; total: number; created: number; updated: number; unchanged: number; errors: number; warnings: number
  rows: { row: number; action: "create" | "update" | "unchanged" | "error"; key: string | null; messages: string[] }[]
}

const ACTION_TONE: Record<string, [string, string]> = {
  create: ["petrol", "Create"], update: ["brass", "Update"], unchanged: ["outline", "Unchanged"], error: ["alarm", "Error"],
}
const NONE = "__none__"

export function ImportWizard({ open, onOpenChange, defaultKind }: { open: boolean; onOpenChange: (o: boolean) => void; defaultKind: Kind }) {
  const qc = useQueryClient()
  const meta = useInventoryMeta()
  const [kind, setKind] = useState<Kind>(defaultKind)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [result, setResult] = useState<ImportResult | null>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) { setKind(defaultKind); setFile(null); setPreview(null); setResult(null); setStep(1); setMapping({}) }
  }, [open, defaultKind])

  const loadPreview = useMutation({
    mutationFn: ({ f, sheet }: { f: File; sheet?: string }) => {
      const fd = new FormData()
      fd.append("file", f)
      if (sheet) fd.append("sheet", sheet)
      return api.upload<Preview>("/inventory/import/preview", fd)
    },
    onSuccess: (p) => { setPreview(p); setMapping(p.suggested[kind]); setResult(null) },
    onError: (e: Error) => { toast.error(e.message); setPreview(null) },
  })

  const run = useMutation({
    mutationFn: (dryRun: boolean) => {
      const fd = new FormData()
      fd.append("file", file!)
      fd.append("kind", kind)
      fd.append("mapping", JSON.stringify(Object.fromEntries(Object.entries(mapping).filter(([, v]) => v))))
      if (preview?.sheet && preview.sheet !== "CSV") fd.append("sheet", preview.sheet)
      fd.append("dry_run", String(dryRun))
      return api.upload<ImportResult>("/inventory/import", fd)
    },
    onSuccess: (r) => {
      setResult(r)
      setStep(3)
      if (!r.dry_run) {
        toast.success(`Import finished: ${r.created} created, ${r.updated} updated`)
        qc.invalidateQueries({ queryKey: ["inv"] })
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const chooseFile = (f: File | null) => {
    setFile(f)
    setPreview(null)
    setResult(null)
    if (f) loadPreview.mutate({ f })
  }
  const fields = meta.data?.import_fields[kind] ?? []
  const missingRequired = fields.filter((f) => f.required && !mapping[f.field])
  const colIdx = (c: string | null | undefined) => (c && preview ? preview.columns.indexOf(c) : -1)
  const toApply = result ? result.created + result.updated : 0
  const shownRows = result ? result.rows.filter((r) => !onlyProblems || r.action === "error" || r.messages.some((m) => /not found|not a known|skipped/i.test(m))) : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import {kind}</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel export from your CMDB or OT inventory, map its columns and check the result before anything is saved.
            Existing records are matched by code, external ID or entity and name.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex gap-4 border-b pb-2 text-[12.5px]" aria-label="Import steps">
          {["File", "Column mapping", "Check and import"].map((l, i) => (
            <li key={l} className={cn("flex items-center gap-1.5", step === i + 1 ? "font-medium text-ink" : "text-ink-3")}>
              <span className={cn("tabular inline-flex size-5 items-center justify-center rounded-full border text-[11px]", step === i + 1 && "border-petrol bg-petrol text-white")}>{i + 1}</span>{l}
            </li>
          ))}
        </ol>

        <div className="max-h-[60vh] min-h-[240px] overflow-y-auto scroll-thin">
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-ink-2">Import</span>
                <Segmented value={kind === "assets" ? "Assets" : "Services"} onChange={(v) => {
                  const k: Kind = v === "Services" ? "services" : "assets"
                  setKind(k)
                  if (preview) setMapping(preview.suggested[k])
                }} options={["Assets", "Services"]} size="sm" />
              </div>
              <button type="button"
                className="flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted/40 px-4 py-6 text-center hover:bg-muted"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); chooseFile(e.dataTransfer.files?.[0] ?? null) }}>
                <Paperclip className="size-5 text-ink-3" />
                <span className="text-[13px] text-ink">{file ? file.name : "Drop a .csv or .xlsx file here or click to choose"}</span>
                <span className="text-[11.5px] text-ink-3">The first row must contain the column headers. Up to 5,000 rows.</span>
              </button>
              <input ref={inputRef} type="file" accept=".csv,.txt,.xlsx,.xlsm" className="hidden" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} />
              {loadPreview.isPending && <p className="text-[13px] text-ink-3">Reading file…</p>}
              {preview && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3 text-[13px]">
                    <FileSpreadsheet className="size-4 text-ink-3" />
                    <span className="text-ink-2"><span className="tabular">{preview.row_count}</span> rows, <span className="tabular">{preview.columns.length}</span> columns</span>
                    {preview.sheets.length > 1 && (
                      <div className="flex items-center gap-2">
                        <span className="text-ink-3">Sheet</span>
                        <OptionSelect className="w-48" size="sm" value={preview.sheet} onChange={(v) => v && file && loadPreview.mutate({ f: file, sheet: v })} options={preview.sheets} />
                      </div>
                    )}
                  </div>
                  <SampleTable columns={preview.columns} rows={preview.sample} />
                </div>
              )}
            </div>
          )}

          {step === 2 && preview && (
            <div className="space-y-2">
              <p className="text-[13px] text-ink-2">Choose the file column for each field. Suggested matches are preselected; fields without a column are left unchanged on existing records.</p>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b text-left text-[12px] text-ink-3">
                    <th className="py-1.5 pr-2 font-medium">Field</th>
                    <th className="px-2 py-1.5 font-medium">File column</th>
                    <th className="px-2 py-1.5 font-medium">First value</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => {
                    const idx = colIdx(mapping[f.field])
                    return (
                      <tr key={f.field} className="border-b last:border-0">
                        <td className="py-1.5 pr-2 text-ink">{f.label}{f.required && <span className="ml-1 text-alarm" aria-label="required">*</span>}</td>
                        <td className="w-72 px-2 py-1.5">
                          <OptionSelect size="sm" value={mapping[f.field] ?? NONE} onChange={(v) => setMapping((m) => ({ ...m, [f.field]: v === NONE ? null : v }))}
                            options={[{ value: NONE, label: <span className="text-ink-3">Do not import</span> }, ...preview.columns.map((c) => ({ value: c, label: c }))]} />
                        </td>
                        <td className="max-w-[260px] truncate px-2 py-1.5 text-[12.5px] text-ink-2">{idx >= 0 ? preview.sample[0]?.[idx] || <span className="text-ink-3">empty</span> : <span className="text-ink-3">–</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {missingRequired.length > 0 && <p className="text-[12.5px] text-alarm">Map a column to {missingRequired.map((f) => f.label).join(", ")}.</p>}
            </div>
          )}

          {step === 3 && result && (
            <div className="space-y-3">
              <div className={cn("rounded-md border px-3 py-2 text-[13px]", result.dry_run ? "bg-surface text-ink-2" : "border-petrol/40 bg-petrol-50 text-petrol")}>
                {result.dry_run ? "Check only: nothing has been saved yet." : "Import completed. The changes are recorded in each object's change history."}
              </div>
              <div className="grid grid-cols-5 gap-4 rounded-md border bg-card px-4 py-3">
                <Stat label="Rows" value={result.total} />
                <Stat label="New" value={result.created} tone={result.created ? "petrol" : undefined} />
                <Stat label="Updated" value={result.updated} />
                <Stat label="Unchanged" value={result.unchanged} />
                <Stat label="Errors" value={result.errors} tone={result.errors ? "alarm" : undefined} hint={result.errors ? "Rows with errors are skipped" : undefined} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="imp-problems" checked={onlyProblems} onCheckedChange={(v) => setOnlyProblems(v === true)} />
                <Label htmlFor="imp-problems" className="text-[12.5px] font-normal text-ink-2">Show errors and warnings only</Label>
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b text-left text-[12px] text-ink-3">
                    <th className="w-14 py-1.5 pr-2 font-medium">Row</th>
                    <th className="w-28 px-2 py-1.5 font-medium">Action</th>
                    <th className="w-32 px-2 py-1.5 font-medium">Record</th>
                    <th className="px-2 py-1.5 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRows.map((r) => {
                    const [tone, label] = ACTION_TONE[r.action]
                    return (
                      <tr key={r.row} className="border-b align-top last:border-0">
                        <td className="tabular py-1.5 pr-2 text-ink-3">{r.row}</td>
                        <td className="px-2 py-1.5"><Pill tone={tone}>{label}</Pill></td>
                        <td className="px-2 py-1.5 font-mono text-[12px] text-ink-2">{r.key ?? "–"}</td>
                        <td className="px-2 py-1.5">
                          {r.messages.length ? <ul className="space-y-0.5">{r.messages.map((m, i) => <li key={i} className={cn("text-[12.5px]", r.action === "error" ? "text-alarm" : "text-ink-2")}>{m}</li>)}</ul> : <span className="text-ink-3">–</span>}
                        </td>
                      </tr>
                    )
                  })}
                  {shownRows.length === 0 && <tr><td colSpan={4} className="py-3 text-center text-[13px] text-ink-3">No rows to show.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter>
          {step > 1 && !(result && !result.dry_run) && <Button variant="outline" onClick={() => { setStep((s) => (s === 3 ? 2 : 1)); setResult(null) }}>Back</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{result && !result.dry_run ? "Close" : "Cancel"}</Button>
          {step === 1 && <Button disabled={!preview || loadPreview.isPending} onClick={() => setStep(2)}>Map columns</Button>}
          {step === 2 && <Button disabled={missingRequired.length > 0 || run.isPending} onClick={() => run.mutate(true)}>{run.isPending ? "Checking…" : "Check import"}</Button>}
          {step === 3 && result?.dry_run && (
            <Button disabled={toApply === 0 || run.isPending} onClick={() => run.mutate(false)}>
              {run.isPending ? "Importing…" : `Import ${toApply} ${toApply === 1 ? "row" : "rows"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SampleTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border scroll-thin">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b bg-surface text-left text-ink-3">
            {columns.map((c) => <th key={c} className="px-2 py-1.5 font-medium whitespace-nowrap">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {columns.map((c, j) => <td key={c} className="max-w-[200px] truncate px-2 py-1 whitespace-nowrap text-ink-2">{r[j]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
