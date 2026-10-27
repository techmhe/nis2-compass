import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Copy, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { ErrorState, Loading } from "@/components/common/basics"
import { OptionSelect } from "@/components/common/fields"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import type { Stage, Track } from "./reporting-types"

interface DraftField { key: string; label: string; text: string }
interface Draft { authority: string; stage_label: string; entity: { code: string; name: string }; incident: { code: string; title: string }; fields: DraftField[] }

const LANGS = [{ value: "de", label: "German" }, { value: "nl", label: "Dutch" }, { value: "en", label: "English" }]

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error("Copying is not allowed in this browser; select the text instead.")
  }
}

/** Report texts per required item, pre-filled from the incident, to review and copy into the authority's portal. */
export function ReportDraftDialog({ t, s, onClose }: { t: Track; s: Stage; onClose: () => void }) {
  const { canAny } = useAuth()
  const [fields, setFields] = useState<DraftField[] | null>(null)
  const [lang, setLang] = useState(t.jurisdiction === "DE" ? "de" : t.jurisdiction === "NL" ? "nl" : "en")
  const q = useQuery({
    queryKey: ["incidents", "draft", t.id, s.stage],
    queryFn: () => api.get<Draft>(`/incident-reporting/tracks/${t.id}/stages/${s.stage}/draft`),
    gcTime: 0,
  })
  const current = fields ?? q.data?.fields ?? []
  const polish = useMutation({
    mutationFn: () => api.post<{ fields: DraftField[]; model: string }>(`/incident-reporting/tracks/${t.id}/stages/${s.stage}/draft/ai`, { language: lang, fields: current }),
    onSuccess: (r) => { setFields(r.fields); toast.success(`Rewritten by ${r.model}. Check every statement before submitting.`) },
    onError: (e: Error) => toast.error(e instanceof ApiError && e.status === 503 ? "The AI assistant is not configured yet." : e.message),
  })
  const setText = (key: string, text: string) => setFields(current.map((f) => (f.key === key ? { ...f, text } : f)))
  const all = current.map((f) => `${f.label}\n${f.text}`).join("\n\n")

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Draft: {s.label}</DialogTitle>
          <DialogDescription>
            {q.data ? `${q.data.incident.code} for ${q.data.entity.code} to ${q.data.authority}. ` : ""}
            Pre-filled from the incident record. Edit the texts, then copy them into the portal; nothing is sent from here.
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : (
          <div className="space-y-3">
            {current.map((f) => (
              <div key={f.key}>
                <div className="mb-1 flex items-start justify-between gap-2">
                  <label htmlFor={`draft-${f.key}`} className="text-[13px] font-medium text-ink">{f.label}</label>
                  <Button size="xs" variant="ghost" onClick={() => copy(f.text, "Text")} aria-label={`Copy ${f.label}`}><Copy /> Copy</Button>
                </div>
                <Textarea id={`draft-${f.key}`} rows={Math.min(8, Math.max(2, Math.ceil(f.text.length / 90)))} value={f.text} onChange={(e) => setText(f.key, e.target.value)} />
              </div>
            ))}
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          {canAny("ai.use") ? (
            <div className="flex items-center gap-2">
              <div className="w-32"><OptionSelect value={lang} onChange={(v) => setLang(v ?? "en")} options={LANGS} /></div>
              <Button variant="outline" disabled={!current.length || polish.isPending} onClick={() => polish.mutate()}
                title="Sends the texts above to the configured AI endpoint">
                <Sparkles className={polish.isPending ? "animate-pulse" : undefined} /> {polish.isPending ? "Rewriting…" : "Rewrite with AI"}
              </Button>
            </div>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button disabled={!current.length} onClick={() => copy(all, "All texts")}><Copy /> Copy all</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
