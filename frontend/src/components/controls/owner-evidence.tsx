import { useState } from "react"
import { Link } from "react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { FileText, Link2, Search, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { StatusPill } from "@/components/common/basics"
import { UploadDialog } from "@/components/common/collab"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { DocLink, DocumentItem, SearchHit } from "@/lib/types"

/** Evidence of an occurrence for control owners who may record it but do not manage controls
 *  (uses /controls/occurrences/{id}/evidence instead of the generic document-link endpoints). */
export function OwnerEvidence({ occurrenceId, entityId, documents, onChange }: {
  occurrenceId: number; entityId: number; documents: DocLink[]; onChange: () => void
}) {
  const { can } = useAuth()
  const base = `/controls/occurrences/${occurrenceId}/evidence`
  const link = useMutation({
    mutationFn: (documentId: number) => api.post(base, { document_id: documentId }),
    onSuccess: () => { toast.success("Evidence linked"); onChange() },
    onError: (e: Error) => toast.error(e.message),
  })
  const unlink = useMutation({
    mutationFn: (linkId: number) => api.del(`${base}/${linkId}`),
    onSuccess: () => { toast.success("Link removed"); onChange() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="space-y-2">
      {documents.length === 0 && <p className="text-[13px] text-ink-3">No evidence linked yet.</p>}
      <ul className="space-y-1">
        {documents.map((d) => (
          <li key={d.link_id} className="group flex items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5">
            <FileText className="size-4 shrink-0 text-ink-3" />
            <Link to={`/documents/${d.document_id}`} className="min-w-0 flex-1 truncate text-[13px] text-ink hover:text-petrol">{d.title}</Link>
            <StatusPill value={d.status} />
            <button type="button" className="text-ink-3 hover:text-alarm" aria-label={`Unlink ${d.title}`} onClick={() => unlink.mutate(d.link_id)}>
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <LinkDialog onPick={(id) => link.mutate(id)} />
        {can("documents.upload", entityId) && (
          <UploadDialog entityId={entityId} onDone={(doc: DocumentItem) => link.mutate(doc.id)}
            trigger={<Button size="sm" variant="outline"><Upload /> Upload</Button>} />
        )}
      </div>
    </div>
  )
}

function LinkDialog({ onPick }: { onPick: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const { data = [], isFetching } = useQuery({
    queryKey: ["doc-search", "owner", q],
    queryFn: () => q.trim() ? api.get<SearchHit[]>("/search", { q, types: ["document"], limit: 15 })
      : api.get<DocumentItem[]>("/documents").then((ds) => ds.slice(0, 15).map((d) => ({ source_id: d.id, title: d.title, snippet: d.doc_type } as SearchHit))),
    enabled: open,
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Link2 /> Link document</Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link evidence</DialogTitle>
          <DialogDescription>Search by title or content.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input autoFocus className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. access review export" aria-label="Search documents" />
        </div>
        <ul className="max-h-80 space-y-1 overflow-auto scroll-thin">
          {isFetching && <li className="p-2 text-[13px] text-ink-3">Searching…</li>}
          {!isFetching && data.length === 0 && <li className="p-2 text-[13px] text-ink-3">No documents found.</li>}
          {data.map((h) => (
            <li key={h.source_id}>
              <button type="button" className="w-full rounded-md px-2.5 py-2 text-left hover:bg-muted" onClick={() => { onPick(h.source_id); setOpen(false) }}>
                <div className="text-[13px] font-medium text-ink">{h.title}</div>
                {h.snippet && <div className="line-clamp-1 text-[12px] text-ink-3">{h.snippet.replace(/[«»]/g, "")}</div>}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
