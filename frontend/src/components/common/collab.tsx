import { useRef, useState, type ReactNode } from "react"
import { Link } from "react-router"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, Link2, Paperclip, Search, Trash2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { EntitySelect, Field, OptionSelect } from "@/components/common/fields"
import { StatusPill } from "@/components/common/basics"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fromNow, initials } from "@/lib/format"
import type { Comment, DocLink, DocumentItem, SearchHit } from "@/lib/types"

// User text must not load images: a same-origin URL such as an export endpoint would run with the viewer's
// session on every render.
export const NO_IMAGES = { disallowedElements: ["img"], unwrapDisallowed: true } as const

export function Markdown({ children, className }: { children: string | null | undefined; className?: string }) {
  if (!children) return null
  return (
    <div className={className ?? "prose-md"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} {...NO_IMAGES} components={{
        a: ({ href, children }) => href?.startsWith("/") && !href.startsWith("//")
          ? <Link to={href}>{children}</Link>
          : <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
      }}>{children}</ReactMarkdown>
    </div>
  )
}

export function UserAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar className={className ?? "size-6"}>
      <AvatarFallback className="bg-petrol-50 text-[10px] font-semibold text-petrol">{initials(name)}</AvatarFallback>
    </Avatar>
  )
}

export function Confirm({ trigger, title, description, confirmLabel = "Delete", onConfirm, destructive = true }: {
  trigger: ReactNode
  title: string
  description?: ReactNode
  confirmLabel?: string
  onConfirm: () => void | Promise<unknown>
  destructive?: boolean
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className={destructive ? "bg-alarm hover:bg-alarm/90" : undefined} onClick={() => onConfirm()}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function CommentsPanel({ targetType, targetId, canComment = true }: { targetType: string; targetId: number; canComment?: boolean }) {
  const qc = useQueryClient()
  const { me } = useAuth()
  const key = ["comments", targetType, targetId]
  const { data = [] } = useQuery({ queryKey: key, queryFn: () => api.get<Comment[]>("/comments", { target_type: targetType, target_id: targetId }) })
  const [body, setBody] = useState("")
  const add = useMutation({
    mutationFn: () => api.post<Comment>("/comments", { body }, { target_type: targetType, target_id: targetId }),
    onSuccess: () => { setBody(""); qc.invalidateQueries({ queryKey: key }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/comments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })
  return (
    <div className="space-y-3">
      {data.length === 0 && <p className="text-[13px] text-ink-3">No comments yet.</p>}
      {data.map((c) => (
        <div key={c.id} className="group flex gap-2.5">
          <UserAvatar name={c.author?.display_name ?? "?"} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[12px] text-ink-3">
              <span className="font-medium text-ink-2">{c.author?.display_name ?? "Deleted user"}</span>
              <span>{fromNow(c.created_at)}</span>
              {c.author?.id === me?.id && (
                <button className="ml-auto opacity-0 group-hover:opacity-100" onClick={() => del.mutate(c.id)} aria-label="Delete comment">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
            <Markdown className="prose-md text-[13px]">{c.body}</Markdown>
          </div>
        </div>
      ))}
      {canComment && (
        <div className="space-y-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment. Mention someone with @name@company.com" rows={2}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) add.mutate() }} />
          <div className="flex justify-end">
            <Button size="sm" disabled={!body.trim() || add.isPending} onClick={() => add.mutate()}>Add comment</Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Documents linked to an object, with "link existing" and "upload new" actions. */
export function DocumentLinks({ targetType, targetId, documents, entityId, canEdit, onChange, compact }: {
  targetType: string
  targetId: number
  documents: DocLink[]
  entityId?: number | null
  canEdit: boolean
  onChange: () => void
  compact?: boolean
}) {
  const unlink = useMutation({
    mutationFn: (linkId: number) => api.del(`/documents/links/${linkId}`),
    onSuccess: () => { toast.success("Link removed"); onChange() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="space-y-2">
      {documents.length === 0 && <p className="text-[13px] text-ink-3">No documents linked.</p>}
      <ul className="space-y-1">
        {documents.map((d) => (
          <li key={d.link_id} className="group flex items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5">
            <FileText className="size-4 shrink-0 text-ink-3" />
            <Link to={`/documents/${d.document_id}`} className="min-w-0 flex-1 truncate text-[13px] text-ink hover:text-petrol">{d.title}</Link>
            {!compact && <span className="text-[11.5px] text-ink-3">{d.doc_type}</span>}
            <StatusPill value={d.status} />
            {canEdit && (
              <button className="text-ink-3 opacity-0 group-hover:opacity-100 hover:text-alarm" aria-label="Unlink" onClick={() => unlink.mutate(d.link_id)}>
                <X className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex gap-2">
          <LinkExistingDialog targetType={targetType} targetId={targetId} onDone={onChange} />
          <UploadDialog link={{ target_type: targetType, target_id: targetId }} entityId={entityId ?? null} onDone={onChange}
            trigger={<Button size="sm" variant="outline"><Upload /> Upload</Button>} />
        </div>
      )}
    </div>
  )
}

function LinkExistingDialog({ targetType, targetId, onDone }: { targetType: string; targetId: number; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const { data = [], isFetching } = useQuery({
    queryKey: ["doc-search", q],
    queryFn: () => q.trim() ? api.get<SearchHit[]>("/search", { q, types: ["document"], limit: 15 }) : api.get<DocumentItem[]>("/documents").then((ds) => ds.slice(0, 15).map((d) => ({ source_id: d.id, title: d.title, snippet: d.doc_type } as SearchHit))),
    enabled: open,
  })
  const link = useMutation({
    mutationFn: (docId: number) => api.post(`/documents/${docId}/links`, { target_type: targetType, target_id: targetId }),
    onSuccess: () => { toast.success("Document linked"); setOpen(false); onDone() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Link2 /> Link document</Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link an existing document</DialogTitle>
          <DialogDescription>Search by title or content.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input autoFocus className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. access control policy" />
        </div>
        <ul className="max-h-80 space-y-1 overflow-auto scroll-thin">
          {isFetching && <li className="p-2 text-[13px] text-ink-3">Searching…</li>}
          {!isFetching && data.length === 0 && <li className="p-2 text-[13px] text-ink-3">No documents found.</li>}
          {data.map((h) => (
            <li key={h.source_id}>
              <button className="w-full rounded-md px-2.5 py-2 text-left hover:bg-muted" onClick={() => link.mutate(h.source_id)}>
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

export function UploadDialog({ trigger, link, entityId, onDone, defaultType = "Evidence" }: {
  trigger: ReactNode
  link?: { target_type: string; target_id: number }
  entityId?: number | null
  onDone?: (doc: DocumentItem) => void
  defaultType?: string
}) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [docType, setDocType] = useState(defaultType)
  const [classification, setClassification] = useState("Internal")
  const [entity, setEntity] = useState<number | null>(entityId ?? null)
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const { data: meta } = useQuery({ queryKey: ["doc-meta"], queryFn: () => api.get<{ types: string[]; classifications: string[]; max_upload_mb: number; allowed_extensions: string[] }>("/documents/meta"), enabled: open })
  const qc = useQueryClient()
  const up = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      if (file) fd.append("file", file)
      fd.append("metadata", JSON.stringify({
        title: title || file?.name.replace(/\.[^.]+$/, "") || "Document", doc_type: docType, classification,
        entity_id: entity, description: description || null, status: "Draft",
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean), link,
      }))
      return api.upload<DocumentItem>("/documents", fd)
    },
    onSuccess: (doc) => {
      toast.success(`Uploaded "${doc.title}"`)
      qc.invalidateQueries({ queryKey: ["documents"] })
      setOpen(false); setFile(null); setTitle(""); setDescription(""); setTags("")
      onDone?.(doc)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            {link ? "The document is linked here after upload." : "Text is extracted automatically so the document becomes searchable."}
          </DialogDescription>
        </DialogHeader>
        <div
          className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted/40 px-4 py-6 text-center hover:bg-muted"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) { setFile(f); if (!title) setTitle(f.name.replace(/\.[^.]+$/, "")) } }}
        >
          <Paperclip className="size-5 text-ink-3" />
          <div className="text-[13px] text-ink">{file ? file.name : "Drop a file here or click to choose"}</div>
          <div className="text-[11.5px] text-ink-3">Up to {meta?.max_upload_mb ?? 50} MB · PDF, Office, text, images, e-mail</div>
          <input ref={inputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, "")) }} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title" className="col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Type"><OptionSelect value={docType} onChange={(v) => setDocType(v ?? "Other")} options={meta?.types ?? [defaultType]} /></Field>
          <Field label="Classification"><OptionSelect value={classification} onChange={(v) => setClassification(v ?? "Internal")} options={meta?.classifications ?? ["Internal"]} /></Field>
          <Field label="Entity" className="col-span-2"><EntitySelect value={entity} onChange={setEntity} /></Field>
          <Field label="Tags" hint="Comma separated" className="col-span-2"><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="policy, backup" /></Field>
          <Field label="Description" className="col-span-2"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!file || up.isPending} onClick={() => up.mutate()}>{up.isPending ? "Uploading…" : "Upload"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
