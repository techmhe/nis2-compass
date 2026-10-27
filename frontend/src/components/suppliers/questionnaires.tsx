import { useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Code, Empty, ErrorState, Loading } from "@/components/common/basics"
import { Field, OptionSelect } from "@/components/common/fields"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { type Question, type Template, type Tier, TIER_ORDER, useSupplierMeta } from "./shared"

interface TemplatesResponse {
  latest: Partial<Record<Tier, Template>>
  versions: { id: number; tier: Tier; version: number; title: string; questions: number; created_at: string; change_note: string | null }[]
  can_edit: boolean
}

export function QuestionnairesSheet({ trigger }: { trigger: ReactNode }) {
  const meta = useSupplierMeta()
  const [open, setOpen] = useState(false)
  const [tier, setTier] = useState<Tier>("critical")
  const [versionId, setVersionId] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const q = useQuery({ queryKey: ["suppliers", "questionnaires"], queryFn: () => api.get<TemplatesResponse>("/suppliers/questionnaires"), enabled: open })
  const latest = q.data?.latest[tier]
  const versions = (q.data?.versions ?? []).filter((v) => v.tier === tier)
  const selectedId = versionId ?? latest?.id ?? null
  const detail = useQuery({
    queryKey: ["suppliers", "questionnaire", selectedId],
    queryFn: () => api.get<Template>(`/suppliers/questionnaires/${selectedId}`),
    enabled: open && selectedId != null && selectedId !== latest?.id,
  })
  const shown = selectedId === latest?.id ? latest : detail.data

  return (
    <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(false) }}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Supplier questionnaires</SheetTitle>
          <SheetDescription>
            One versioned question set per tier, based on IR 2024/2690 point 5.1 and ENISA supply chain good practices. Suppliers receive it as an Excel workbook and return their answers in the same file.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Tier" className="inline-flex rounded-md border bg-surface p-0.5">
              {TIER_ORDER.map((t) => (
                <button key={t} role="tab" aria-selected={tier === t} type="button"
                  onClick={() => { setTier(t); setVersionId(null); setEditing(false) }}
                  className={cn("h-7 rounded-[4px] px-3 text-[12.5px] font-medium", tier === t ? "bg-petrol text-white" : "text-ink-2 hover:bg-muted")}>
                  {meta.tiers[t]}
                </button>
              ))}
            </div>
            {versions.length > 0 && !editing && (
              <OptionSelect className="w-56" size="sm" value={selectedId ? String(selectedId) : null} onChange={(v) => setVersionId(v ? Number(v) : null)}
                options={versions.map((v) => ({ value: String(v.id), label: `Version ${v.version} (${fmtDate(v.created_at)})${v.id === latest?.id ? ", current" : ""}` }))} />
            )}
            {q.data?.can_edit && latest && !editing && (
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => { setVersionId(null); setEditing(true) }}>Edit questions</Button>
            )}
          </div>
          {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : editing && latest ? (
            <TemplateEditor template={latest} onDone={() => setEditing(false)} />
          ) : !shown ? (
            detail.isLoading ? <Loading /> : <Empty title="No questionnaire for this tier">Run the seed or ask an administrator to create the first version.</Empty>
          ) : (
            <div className="space-y-3">
              <div className="text-[13px] text-ink-2">
                <span className="font-medium text-ink">{shown.title}</span>, version {shown.version}, {shown.questions.length} questions
                {shown.created_by && <span className="text-ink-3">, created by {shown.created_by}</span>}
                {shown.change_note && <p className="mt-1 text-[12.5px] text-ink-3">{shown.change_note}</p>}
              </div>
              <QuestionTable questions={shown.questions} />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function QuestionTable({ questions }: { questions: Question[] }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b bg-surface text-left text-[12px] text-ink-3">
            <th className="w-14 px-3 py-2 font-medium">ID</th>
            <th className="w-32 px-2 py-2 font-medium">Section</th>
            <th className="px-2 py-2 font-medium">Question</th>
            <th className="w-16 px-3 py-2 text-right font-medium">Weight</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((qq) => (
            <tr key={qq.id} className="border-b align-top last:border-0">
              <td className="px-3 py-2"><Code>{qq.id}</Code></td>
              <td className="px-2 py-2 text-ink-2">{qq.section}</td>
              <td className="px-2 py-2">
                <div className="text-ink">{qq.text}</div>
                {qq.reference && <div className="mt-0.5 text-[12px] text-ink-3">{qq.reference}</div>}
              </td>
              <td className="tabular px-3 py-2 text-right">{qq.weight}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TemplateEditor({ template, onDone }: { template: Template; onDone: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(template.title)
  const [note, setNote] = useState("")
  const [items, setItems] = useState<Question[]>(template.questions.map((x) => ({ ...x })))
  const upd = (i: number, patch: Partial<Question>) => setItems((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i: number, d: number) => setItems((p) => {
    const n = [...p]
    const j = i + d
    if (j < 0 || j >= n.length) return p
    ;[n[i], n[j]] = [n[j], n[i]]
    return n
  })
  const ids = items.map((x) => x.id?.trim()).filter(Boolean)
  const dup = ids.length !== new Set(ids).size
  const save = useMutation({
    mutationFn: () => api.post<Template>("/suppliers/questionnaires", {
      tier: template.tier, title: title.trim(), change_note: note.trim() || null,
      questions: items.map((x) => ({ id: x.id?.trim() || null, section: x.section?.trim() || null, text: x.text.trim(), reference: x.reference?.trim() || null, weight: x.weight })),
    }),
    onSuccess: (t) => {
      toast.success(`Version ${t.version} saved`)
      qc.invalidateQueries({ queryKey: ["suppliers", "questionnaires"] })
      onDone()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const valid = title.trim() && items.length > 0 && items.every((x) => x.text.trim()) && !dup
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title" htmlFor="tpl-title"><Input id="tpl-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Change note" htmlFor="tpl-note"><Input id="tpl-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed and why" /></Field>
      </div>
      <p className="text-[12.5px] text-ink-3">Saving creates version {template.version + 1}. Workbooks already sent keep their version and can still be imported. New questions without an ID get the next free number.</p>
      <ul className="space-y-2">
        {items.map((x, i) => (
          <li key={i} className="grid grid-cols-[64px_140px_1fr_64px_auto] items-start gap-2 rounded-md border bg-card p-2">
            <Input aria-label="Question ID" value={x.id ?? ""} onChange={(e) => upd(i, { id: e.target.value.slice(0, 10) })} placeholder="New" className="font-mono text-[12.5px]" />
            <Input aria-label="Section" value={x.section ?? ""} onChange={(e) => upd(i, { section: e.target.value })} placeholder="Section" />
            <div className="space-y-1.5">
              <Textarea aria-label="Question" rows={2} value={x.text} onChange={(e) => upd(i, { text: e.target.value })} placeholder="Question text" />
              <Input aria-label="Reference" value={x.reference ?? ""} onChange={(e) => upd(i, { reference: e.target.value })} placeholder="Reference, e.g. IR 5.1.4(d)" className="h-8 text-[12.5px]" />
            </div>
            <Input aria-label="Weight" type="number" min={1} max={5} value={x.weight} onChange={(e) => upd(i, { weight: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })} />
            <div className="flex flex-col">
              <Button variant="ghost" size="icon-xs" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp /></Button>
              <Button variant="ghost" size="icon-xs" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === items.length - 1}><ArrowDown /></Button>
              <Button variant="ghost" size="icon-xs" aria-label="Remove question" onClick={() => setItems((p) => p.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          </li>
        ))}
      </ul>
      {dup && <ErrorState error="Question IDs must be unique." />}
      <div className="flex items-center justify-between">
        <Button size="sm" variant="outline" onClick={() => setItems((p) => [...p, { id: null, section: null, text: "", reference: null, weight: 1 }])}><Plus /> Add question</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onDone}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save as new version"}</Button>
        </div>
      </div>
    </div>
  )
}
