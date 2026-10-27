import { useRef, useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Paperclip } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/common/fields"
import { api } from "@/lib/api"
import { bytes } from "@/lib/format"
import type { DocumentItem } from "@/lib/types"

export function NewVersionDialog({ doc, trigger, maxMb }: { doc: DocumentItem; trigger: ReactNode; maxMb?: number }) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState("")
  const [label, setLabel] = useState(doc.version_label ?? "")
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const up = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append("file", file!)
      if (note.trim()) fd.append("change_note", note.trim())
      if (label.trim() && label.trim() !== (doc.version_label ?? "")) fd.append("version_label", label.trim())
      return api.upload<DocumentItem>(`/documents/${doc.id}/versions`, fd)
    },
    onSuccess: (d) => {
      toast.success(`Version ${d.current_version?.version_no ?? ""} uploaded`)
      qc.invalidateQueries({ queryKey: ["documents"] })
      setOpen(false)
      setFile(null)
      setNote("")
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) setLabel(doc.version_label ?? "") }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload new version</DialogTitle>
          <DialogDescription>The new file becomes the current version of “{doc.title}”. Earlier versions stay available in the history.</DialogDescription>
        </DialogHeader>
        <button type="button"
          className={`flex w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6 text-center hover:bg-muted ${dragging ? "border-petrol bg-petrol-50" : "bg-muted/40"}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f) }}>
          <Paperclip className="size-5 text-ink-3" />
          <span className="text-[13px] text-ink">{file ? `${file.name} (${bytes(file.size)})` : "Drop a file here or click to choose"}</span>
          <span className="text-[11.5px] text-ink-3">Up to {maxMb ?? 50} MB</span>
        </button>
        <input ref={inputRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Version label" hint="e.g. 1.1 or 2025-Q3">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
          </Field>
          <Field label="Change note" className="col-span-2">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed in this version?" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!file || up.isPending} onClick={() => up.mutate()}>{up.isPending ? "Uploading…" : "Upload version"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
