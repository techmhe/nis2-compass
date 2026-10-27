import { useMemo, useState } from "react"
import { Link } from "react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { ChevronRight, Plus, Search, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Code, Pill } from "@/components/common/basics"
import { Confirm } from "@/components/common/collab"
import { Field, OptionSelect } from "@/components/common/fields"
import { api } from "@/lib/api"
import type { ProvisionLink, SearchHit } from "@/lib/types"
import { cn } from "@/lib/utils"
import { RELATION_LABEL } from "./shared"

/** Legal references of a requirement, grouped by regulation, each linking into the regulations library. */
export function ProvisionList({ provisions, canManage = false, onRemoved, dense = false }: {
  provisions: ProvisionLink[]
  canManage?: boolean
  onRemoved?: () => void
  dense?: boolean
}) {
  const groups = useMemo(() => {
    const m = new Map<string, { code: string; title: string; regulationId: number; items: ProvisionLink[] }>()
    for (const p of provisions) {
      const g = m.get(p.regulation_code) ?? { code: p.regulation_code, title: p.regulation_title, regulationId: p.regulation_id, items: [] }
      g.items.push(p)
      m.set(p.regulation_code, g)
    }
    return [...m.values()]
  }, [provisions])

  const remove = useMutation({
    mutationFn: (linkId: number) => api.del(`/requirement-provisions/${linkId}`),
    onSuccess: () => { toast.success("Legal reference removed"); onRemoved?.() },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!provisions.length) return <p className="text-[13px] text-ink-3">No legal references linked yet.</p>
  return (
    <div className={dense ? "space-y-3" : "space-y-4"}>
      {groups.map((g) => (
        <div key={g.code}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <Link to={`/regulations/${g.regulationId}`} className="text-[12.5px] font-semibold text-ink hover:text-petrol">{g.title}</Link>
            <span className="text-[11.5px] text-ink-3">{g.items.length === 1 ? "1 provision" : `${g.items.length} provisions`}</span>
          </div>
          <ul className="space-y-1">
            {g.items.map((p) => <ProvisionItem key={p.link_id} p={p} canManage={canManage} onRemove={() => remove.mutate(p.link_id)} />)}
          </ul>
        </div>
      ))}
    </div>
  )
}

function ProvisionItem({ p, canManage, onRemove }: { p: ProvisionLink; canManage: boolean; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="group rounded-md border bg-surface">
      <div className="flex items-start gap-1.5 px-2 py-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Hide provision text" : "Show provision text"}
          className="mt-0.5 rounded text-ink-3 hover:text-ink" disabled={!p.text}>
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90", !p.text && "opacity-30")} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <Link to={`/regulations/${p.regulation_id}?p=${p.provision_id}`} className="hover:text-petrol">
              <Code className="text-ink hover:text-petrol">{p.ref}</Code>
            </Link>
            {p.heading && <span className="text-[12.5px] text-ink-2">{p.heading}</span>}
          </div>
          {p.note && <div className="text-[12px] text-ink-3">{p.note}</div>}
        </div>
        <Pill tone={p.relation === "legal_basis" ? "petrol" : p.relation === "benchmark" ? "brass" : "neutral"}>
          {RELATION_LABEL[p.relation] ?? p.relation}
        </Pill>
        {canManage && (
          <Confirm title="Remove this legal reference?" description={`${p.regulation_code} ${p.ref} will no longer be linked to this requirement.`}
            confirmLabel="Remove link" onConfirm={onRemove}
            trigger={<button className="mt-0.5 text-ink-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-alarm" aria-label={`Remove link to ${p.ref}`}><X className="size-3.5" /></button>} />
        )}
      </div>
      {open && p.text && <div className="prose-law border-t px-3 py-2 text-[12.5px]">{p.text}</div>}
    </li>
  )
}

const RELATIONS = Object.entries(RELATION_LABEL).map(([value, label]) => ({ value, label }))

export function AddProvisionDialog({ requirementId, onDone }: { requirementId: number; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<SearchHit | null>(null)
  const [relation, setRelation] = useState("related")
  const [note, setNote] = useState("")
  const term = q.trim()
  const hits = useQuery({
    queryKey: ["provision-search", term],
    queryFn: () => api.get<SearchHit[]>("/regulations/search", { q: term, limit: 25 }),
    enabled: open && term.length >= 2,
  })
  const add = useMutation({
    mutationFn: () => api.post(`/requirements/${requirementId}/provisions`, { provision_id: picked!.source_id, relation, note: note || null }),
    onSuccess: () => {
      toast.success("Legal reference linked")
      setOpen(false); setPicked(null); setQ(""); setNote(""); setRelation("related")
      onDone()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="xs" variant="outline"><Plus /> Link provision</Button></DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Link a legal provision</DialogTitle>
          <DialogDescription>Search the regulations library by article, keyword or reference.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input autoFocus className="pl-8" value={q} onChange={(e) => { setQ(e.target.value); setPicked(null) }} placeholder="e.g. backup, Art. 21, § 30 BSIG" />
        </div>
        <ul className="max-h-72 space-y-1 overflow-auto scroll-thin">
          {term.length < 2 && <li className="p-2 text-[13px] text-ink-3">Type at least two characters to search.</li>}
          {hits.isFetching && <li className="p-2 text-[13px] text-ink-3">Searching…</li>}
          {hits.error && <li className="p-2 text-[13px] text-alarm">{(hits.error as Error).message}</li>}
          {!hits.isFetching && term.length >= 2 && hits.data?.length === 0 && <li className="p-2 text-[13px] text-ink-3">No provisions match "{term}".</li>}
          {hits.data?.map((h) => (
            <li key={h.source_id}>
              <button type="button" onClick={() => setPicked(h)}
                className={cn("w-full rounded-md border px-2.5 py-2 text-left", picked?.source_id === h.source_id ? "border-petrol bg-petrol-50" : "border-transparent hover:bg-muted")}>
                <div className="text-[13px] font-medium text-ink">{h.title}</div>
                {h.snippet && h.snippet !== h.title && <div className="line-clamp-2 text-[12px] text-ink-3">{h.snippet.replace(/[«»]/g, "")}</div>}
              </button>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Relation"><OptionSelect value={relation} onChange={(v) => setRelation(v ?? "related")} options={RELATIONS} /></Field>
          <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!picked || add.isPending} onClick={() => add.mutate()}>Link provision</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
