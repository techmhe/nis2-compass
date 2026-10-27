import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ErrorState, Section } from "@/components/common/basics"
import { Field, OptionSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { useProjects, useRounds } from "@/hooks/useRefData"
import { api, download } from "@/lib/api"
import { bytes } from "@/lib/format"

interface ImportResult {
  entities: Record<string, number>
  action_items_new: number
  unknown_entities: string[]
  unknown_responsible: string[]
  skipped_locked: string[]
  skipped_no_permission: string[]
  dry_run: boolean
}

export function DataSection() {
  const { canAny, canGlobal } = useAuth()
  const rounds = useRounds()
  const projects = useProjects()
  const [roundId, setRoundId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const currentRound = roundId ?? (rounds.data?.find((r) => r.is_current)?.id ?? rounds.data?.[0]?.id)?.toString() ?? null
  const currentProject = projectId ?? projects.data?.[0]?.id?.toString() ?? null

  const run = async (key: string, path: string, name: string) => {
    setBusy(key)
    try {
      await download(path, name)
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const canExportGap = canAny("reports.export") && canAny("assessments.read")
  const canExportProject = canGlobal("reports.export") && canGlobal("projects.read")

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="GAP analysis workbook">
          <p className="mb-3 text-[13px] text-ink-2">
            All requirements with the answers of every entity you may see, scores per chapter, the dashboard and the action plan, in the layout of the original Excel GAP analysis.
          </p>
          {canExportGap ? (
            <div className="flex items-end gap-2">
              <Field label="Assessment round" className="flex-1">
                <OptionSelect value={currentRound} onChange={setRoundId}
                  options={(rounds.data ?? []).map((r) => ({ value: String(r.id), label: r.name + (r.is_current ? " (current)" : "") }))} />
              </Field>
              <Button disabled={!currentRound || busy === "gap"} onClick={() => run("gap", `/export/gap-workbook?round_id=${currentRound}`, "NIS2_GAP_Analysis.xlsx")}>
                <Download /> {busy === "gap" ? "Preparing…" : "Download workbook"}
              </Button>
            </div>
          ) : <p className="text-[12.5px] text-ink-3">Exporting needs the permission “Export reports and workbooks”.</p>}
        </Section>
        <Section title="Project plan workbook">
          <p className="mb-3 text-[13px] text-ink-2">Master plan, gates, RACI, RAID log and work packages of the implementation project, in the layout of the original project plan.</p>
          {canExportProject ? (
            <div className="flex items-end gap-2">
              <Field label="Project" className="flex-1">
                <OptionSelect value={currentProject} onChange={setProjectId} options={(projects.data ?? []).map((p) => ({ value: String(p.id), label: p.name }))} />
              </Field>
              <Button disabled={!currentProject || busy === "project"} onClick={() => run("project", `/export/project-workbook/${currentProject}`, "NIS2_Implementation_Project_Plan.xlsx")}>
                <Download /> {busy === "project" ? "Preparing…" : "Download workbook"}
              </Button>
            </div>
          ) : <p className="text-[12.5px] text-ink-3">Exporting the project needs group-wide export and project read permissions.</p>}
        </Section>
      </div>
      {canAny("assessments.edit") && <ImportCard rounds={(rounds.data ?? []).filter((r) => r.status !== "closed")} />}
    </div>
  )
}

function ImportCard({ rounds }: { rounds: { id: number; name: string; is_current: boolean }[] }) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [roundId, setRoundId] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [applied, setApplied] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const round = roundId ?? rounds.find((r) => r.is_current)?.id.toString() ?? rounds[0]?.id.toString() ?? null

  const send = (dryRun: boolean) => {
    const fd = new FormData()
    fd.append("file", file!)
    return api.upload<ImportResult>("/import/gap-workbook", fd, { dry_run: dryRun, round_id: round })
  }
  const check = useMutation({
    mutationFn: () => send(true),
    onMutate: () => { setError(null); setPreview(null); setApplied(null) },
    onSuccess: setPreview,
    onError: (e: Error) => setError(e.message),
  })
  const apply = useMutation({
    mutationFn: () => send(false),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      setApplied(r)
      setPreview(null)
      toast.success("Workbook imported")
      qc.invalidateQueries()
    },
    onError: (e: Error) => setError(e.message),
  })
  const changes = preview ? Object.values(preview.entities).reduce((a, b) => a + b, 0) + preview.action_items_new : 0

  return (
    <Section title="Import GAP analysis workbook">
      <p className="mb-3 max-w-[80ch] text-[13px] text-ink-2">
        Update answers and the action plan from a filled-in GAP workbook, for example after an offline workshop. The import first shows what would change;
        nothing is written until you apply it. Each changed answer keeps a revision, and existing action plan items are never overwritten.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Workbook (.xlsx)">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}><FileSpreadsheet /> {file ? "Choose another file" : "Choose file"}</Button>
            <span className="max-w-[280px] truncate text-[12.5px] text-ink-2">{file ? `${file.name} (${bytes(file.size)})` : "No file chosen"}</span>
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setApplied(null); setError(null); e.target.value = "" }} />
        </Field>
        <Field label="Into round" className="w-64">
          <OptionSelect value={round} onChange={(v) => { setRoundId(v); setPreview(null) }} options={rounds.map((r) => ({ value: String(r.id), label: r.name }))}
            placeholder={rounds.length ? "Choose round" : "No open round"} />
        </Field>
        <Button disabled={!file || !round || check.isPending} onClick={() => check.mutate()}><Upload /> {check.isPending ? "Checking…" : "Check workbook"}</Button>
      </div>
      {error && <ErrorState error={error} className="mt-3" />}
      {(preview || applied) && (
        <div className="mt-4 rounded-md border">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-[13px] font-medium">
            {applied ? <><CheckCircle2 className="size-4 text-petrol" /> Import applied</> : <>Preview: {changes === 0 ? "nothing would change" : `${changes} change${changes === 1 ? "" : "s"} found`}</>}
          </div>
          <ImportSummary r={(applied ?? preview)!} />
          {preview && (
            <div className="flex items-center gap-2 border-t px-3 py-2">
              <Button disabled={changes === 0 || apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? "Importing…" : "Apply import"}</Button>
              <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

function ImportSummary({ r }: { r: ImportResult }) {
  const warn = (label: string, items: string[], hint: string) => items.length > 0 && (
    <li className="flex gap-2 text-amber">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span><span className="font-medium">{label}:</span> {items.join(", ")}. <span className="text-ink-3">{hint}</span></span>
    </li>
  )
  const verb = r.dry_run ? "would be" : "were"
  return (
    <div className="px-3 py-2.5 text-[13px]">
      <table className="mb-2 text-[13px]">
        <tbody>
          {Object.entries(r.entities).map(([code, n]) => (
            <tr key={code}>
              <td className="py-0.5 pr-6 font-mono text-[12.5px] text-ink-2">{code}</td>
              <td className="tabular py-0.5 text-ink">{n} answer{n === 1 ? "" : "s"} {verb} updated</td>
            </tr>
          ))}
          <tr>
            <td className="py-0.5 pr-6 text-ink-2">Action plan</td>
            <td className="tabular py-0.5 text-ink">{r.action_items_new} new item{r.action_items_new === 1 ? "" : "s"} {verb} created</td>
          </tr>
        </tbody>
      </table>
      <ul className="space-y-1 text-[12.5px]">
        {warn("Unknown entities", r.unknown_entities, "Their sheets are skipped; entity codes must match.")}
        {warn("Locked assessments", r.skipped_locked, "Unlock the assessment or ask an assessment manager.")}
        {warn("No permission", r.skipped_no_permission, "You may not edit these entities' assessments.")}
        {warn("Unknown responsible", r.unknown_responsible, "Create these stakeholders first or the responsible field stays unchanged.")}
      </ul>
    </div>
  )
}
