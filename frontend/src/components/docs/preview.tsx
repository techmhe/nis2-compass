import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronUp, FileWarning, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Empty, ErrorState, Loading } from "@/components/common/basics"
import { Markdown } from "@/components/common/collab"
import { HighlightTerm } from "@/components/docs/shared"
import { api } from "@/lib/api"
import type { DocVersion } from "@/lib/types"
import { cn } from "@/lib/utils"

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

export function previewKind(v: DocVersion | null | undefined): "pdf" | "image" | null {
  if (!v) return null
  if (v.mime_type === "application/pdf") return "pdf"
  if (IMAGE_TYPES.includes(v.mime_type)) return "image"
  return null
}

function inlineUrl(docId: number, v: DocVersion) {
  return `/api/documents/${docId}/versions/${v.id}/download?inline=true`
}

/**
 * PDF preview. The server delivers files with a sandboxing CSP, which browsers' built-in PDF viewers refuse to
 * run under, so the bytes are fetched and shown from a local object URL typed strictly as application/pdf.
 */
function PdfFrame({ docId, version, title }: { docId: number; version: DocVersion; title: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    setUrl(null)
    setError(null)
    fetch(inlineUrl(docId, version), { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) {
          let msg = `${r.status} ${r.statusText}`
          try { msg = (await r.json()).detail ?? msg } catch { /* not json */ }
          throw new Error(msg)
        }
        return r.blob()
      })
      .then((b) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(new Blob([b], { type: "application/pdf" }))
        setUrl(objectUrl)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [docId, version])
  if (error) return <ErrorState error={`The preview could not be loaded: ${error}`} />
  if (!url) return <Loading label="Loading preview" />
  return <iframe src={url} title={`Preview of ${title}`} className="h-[72vh] min-h-[480px] w-full rounded-md border bg-muted" />
}

export function FilePreview({ docId, version, title }: { docId: number; version: DocVersion; title: string }) {
  const kind = previewKind(version)
  if (kind === "pdf") return <PdfFrame docId={docId} version={version} title={title} />
  if (kind === "image") {
    return (
      <div className="flex max-h-[72vh] items-start justify-center overflow-auto rounded-md border bg-muted p-3 scroll-thin">
        <img src={inlineUrl(docId, version)} alt={`Preview of ${title}`} className="max-w-full" />
      </div>
    )
  }
  return (
    <Empty title="No visual preview for this file type" icon={<FileWarning className="size-6" />}>
      Previews are available for PDF files and images. Use the text view or download the file.
    </Empty>
  )
}

const EXTRACTION_MESSAGE: Record<string, string> = {
  empty: "The file contains no extractable text (for example a scanned PDF without OCR or an image).",
  failed: "Text extraction failed for this file. Download it to read the content.",
  unsupported: "Text extraction is not supported for this file type.",
  pending: "Text extraction has not finished yet.",
}

/** Extracted text of a version, with in-text search. Markdown files are rendered. */
export function ExtractedText({ docId, version }: { docId: number; version: DocVersion }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["documents", "text", docId, version.id],
    queryFn: () => api.get<{ text: string | null; status: string; filename: string }>(`/documents/${docId}/text`, { version_id: version.id }),
  })
  const [term, setTerm] = useState("")
  const [active, setActive] = useState(0)
  const marks = useRef<(HTMLElement | null)[]>([])
  const text = data?.text ?? ""
  const isMarkdown = version.filename.toLowerCase().endsWith(".md") || version.mime_type === "text/markdown"
  const searching = term.trim().length >= 2
  const count = useMemo(() => {
    if (!searching) return 0
    const esc = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return (text.match(new RegExp(esc, "gi")) ?? []).length
  }, [text, term, searching])

  useEffect(() => { setActive(0) }, [term])
  useEffect(() => {
    if (searching && count) marks.current[active]?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [active, count, searching])

  if (isLoading) return <Loading label="Loading text" />
  if (error) return <ErrorState error={error} />
  if (!text.trim()) {
    return (
      <Empty title="No text available" icon={<FileWarning className="size-6" />}>
        {EXTRACTION_MESSAGE[data?.status ?? ""] ?? "This version has no extracted text."}
      </Empty>
    )
  }
  const step = (d: 1 | -1) => setActive((a) => (count ? (a + d + count) % count : 0))
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-ink-3" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Find in text" className="h-8 pl-8 text-[13px]"
            aria-label="Find in text" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1) } }} />
        </div>
        {searching && (
          <>
            <span className="tabular text-[12px] text-ink-3">{count ? `${active + 1} of ${count}` : "No match"}</span>
            <Button size="icon-sm" variant="ghost" aria-label="Previous match" disabled={!count} onClick={() => step(-1)}><ChevronUp /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Next match" disabled={!count} onClick={() => step(1)}><ChevronDown /></Button>
          </>
        )}
        <span className="ml-auto text-[12px] text-ink-3">{text.length.toLocaleString("en")} characters</span>
      </div>
      <div className={cn("max-h-[72vh] overflow-auto rounded-md border bg-surface px-5 py-4 scroll-thin")}>
        {isMarkdown && !searching ? (
          <Markdown className="prose-md max-w-[80ch]">{text}</Markdown>
        ) : (
          <div className="prose-law max-w-[90ch]">
            <HighlightTerm text={text} term={term} activeIndex={active} markRef={(el, i) => { marks.current[i] = el }} />
          </div>
        )}
      </div>
    </div>
  )
}
