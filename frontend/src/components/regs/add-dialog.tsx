import { useMemo, useRef, useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FileJson } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { ErrorState } from "@/components/common/basics"
import { api } from "@/lib/api"
import type { Regulation } from "@/lib/types"

const EXAMPLE = {
  code: "ISMS-POL",
  title: "Group information security policy framework",
  short_title: "ISMS policy framework",
  kind: "internal_standard",
  jurisdiction: "INT",
  language: "en",
  version_date: "2026-01-15",
  status_note: "Approved by the management board on 15 January 2026.",
  license_note: "Internal document, not for external distribution.",
  provisions: [
    {
      key: "1", ref: "Section 1", heading: "Scope", text: null,
      children: [
        { key: "1.1", ref: "Section 1.1", text: "This framework applies to all entities of the group.", children: [] },
      ],
    },
    {
      key: "2", ref: "Section 2", heading: "Roles", text: "The management board is accountable for information security.",
      children: [],
    },
  ],
}

interface ProvIn { key: string; ref: string; heading?: string | null; text?: string | null; children?: ProvIn[] }

function validate(raw: string): { value?: Record<string, unknown>; errors: string[]; count: number } {
  const errors: string[] = []
  let value: any
  try {
    value = JSON.parse(raw)
  } catch (e) {
    return { errors: [`The text is not valid JSON: ${(e as Error).message}`], count: 0 }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { errors: ["The JSON must be an object."], count: 0 }
  for (const f of ["code", "title", "short_title"]) {
    if (typeof value[f] !== "string" || !value[f].trim()) errors.push(`"${f}" is required.`)
  }
  if (typeof value.code === "string" && !/^[A-Za-z0-9_\-/.]+$/.test(value.code)) {
    errors.push(`"code" may only contain letters, digits and _ - / . (no spaces).`)
  }
  if (value.source_url && !/^https?:\/\//.test(value.source_url)) errors.push(`"source_url" must start with http:// or https://.`)
  if (value.version_date && !/^\d{4}-\d{2}-\d{2}$/.test(value.version_date)) errors.push(`"version_date" must be a date like 2026-01-31.`)
  if (value.provisions !== undefined && !Array.isArray(value.provisions)) errors.push(`"provisions" must be a list.`)
  let count = 0
  const keys = new Set<string>()
  const walk = (list: ProvIn[], path: string) => {
    list.forEach((p, i) => {
      const where = `${path}[${i}]`
      if (!p || typeof p !== "object") { errors.push(`${where} is not an object.`); return }
      count += 1
      if (typeof p.key !== "string" || !p.key) errors.push(`${where}: "key" is required.`)
      else if (keys.has(p.key)) errors.push(`${where}: duplicate key "${p.key}".`)
      else keys.add(p.key)
      if (typeof p.ref !== "string" || !p.ref) errors.push(`${where}: "ref" is required.`)
      if (p.children !== undefined && !Array.isArray(p.children)) errors.push(`${where}: "children" must be a list.`)
      else if (p.children) walk(p.children, `${where}.children`)
    })
  }
  if (Array.isArray(value.provisions)) walk(value.provisions, "provisions")
  return { value, errors: errors.slice(0, 8), count }
}

export function AddRegulationDialog({ trigger, onCreated }: { trigger: ReactNode; onCreated: (r: Regulation) => void }) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState("")
  const [serverError, setServerError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const check = useMemo(() => (raw.trim() ? validate(raw) : null), [raw])
  const create = useMutation({
    mutationFn: () => api.post<Regulation>("/regulations", check!.value),
    onMutate: () => setServerError(null),
    onSuccess: (r) => {
      toast.success(`Added "${r.short_title}"`)
      qc.invalidateQueries({ queryKey: ["regulations"] })
      setOpen(false)
      setRaw("")
      onCreated(r)
    },
    onError: (e: Error) => setServerError(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setServerError(null) }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add custom regulation</DialogTitle>
          <DialogDescription>
            Import an internal standard, contract or sector rule as a provision tree. Requirements can then be linked to its provisions,
            and the text becomes searchable for everyone with library access.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setRaw(JSON.stringify(EXAMPLE, null, 2))}>Insert example</Button>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><FileJson /> Load .json file</Button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(setRaw); e.target.value = "" }} />
        </div>
        <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={16} spellCheck={false} aria-label="Regulation JSON"
          className="font-mono text-[12px] leading-relaxed"
          placeholder={'{\n  "code": "ISMS-POL",\n  "title": "…",\n  "short_title": "…",\n  "kind": "internal_standard",\n  "jurisdiction": "INT",\n  "language": "en",\n  "provisions": [{ "key": "1", "ref": "Section 1", "heading": "Scope", "text": "…", "children": [] }]\n}'} />
        <p className="text-[12px] text-ink-3">
          Required: <code className="font-mono">code</code>, <code className="font-mono">title</code>, <code className="font-mono">short_title</code>.
          Optional: kind, jurisdiction (EU, DE, NL, INT), language, version_date, source_url, status_note, license_note.
          Each provision needs a unique <code className="font-mono">key</code> and a <code className="font-mono">ref</code>; heading, text and children are optional.
        </p>
        {check && check.errors.length > 0 && (
          <div role="alert" className="rounded-md border border-alarm/30 bg-alarm-50 p-3 text-[13px] text-alarm">
            <div className="mb-1 font-medium">The JSON cannot be imported yet:</div>
            <ul className="list-disc space-y-0.5 pl-4">{check.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        {check && check.errors.length === 0 && (
          <p className="rounded-md bg-petrol-50 px-3 py-2 text-[12.5px] text-petrol">
            Ready to import “{String(check.value?.short_title)}” with {check.count} provision{check.count === 1 ? "" : "s"}.
          </p>
        )}
        {serverError && <ErrorState error={serverError} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!check || check.errors.length > 0 || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Importing…" : "Import regulation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
