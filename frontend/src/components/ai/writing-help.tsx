import { useRef, useState } from "react"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Loading } from "@/components/common/basics"
import { useAuth } from "@/hooks/useAuth"
import { ApiError, api } from "@/lib/api"

export type TargetType = "answer" | "risk" | "incident" | "audit" | "audit_finding" | "effectiveness_review"

type Mode = "proofread" | "expand" | "translate"
interface Action { label: string; mode: Mode; language: "de" | "nl" | "en" | null }

const MAX_LENGTH = 6000
const ACTIONS: Action[] = [
  { label: "Proofread", mode: "proofread", language: null },
  { label: "Write out from bullet points", mode: "expand", language: null },
  { label: "Translate to German", mode: "translate", language: "de" },
  { label: "Translate to Dutch", mode: "translate", language: "nl" },
  { label: "Translate to English", mode: "translate", language: "en" },
]

type Run = { action: Action; original: string; state: "pending" | "done" | "error"; text: string; error: string }

/** AI menu for a long text field: proofread, write out or translate. Shows the result next to the original; nothing changes until "Apply". */
export function WritingHelp({ target, field, value, onApply, autosave, disabled }: {
  target: { type: TargetType; id: number }
  field: string
  value: string
  onApply: (text: string) => void
  autosave: boolean
  disabled?: boolean
}) {
  const { canAny } = useAuth()
  const [run, setRun] = useState<Run | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const ticket = useRef(0)
  if (disabled || !canAny("ai.use")) return null

  const empty = !value.trim()
  const tooLong = value.trim().length > MAX_LENGTH
  const title = empty ? "Write something first" : tooLong ? `Too long for writing help (max. ${MAX_LENGTH} characters)` : "Writing help"

  const start = (action: Action, original: string) => {
    const mine = ++ticket.current
    setRun({ action, original, state: "pending", text: "", error: "" })
    api.post<{ text: string; model: string }>("/ai/assist/text", {
      mode: action.mode, language: action.language, target, field, text: original,
    }).then(
      (res) => { if (mine === ticket.current) setRun((r) => r && { ...r, state: "done", text: res.text }) },
      (e: Error) => {
        if (mine !== ticket.current) return
        if (e instanceof ApiError && e.status === 503) {
          setRun(null)
          toast.error("The AI assistant is not configured yet. An administrator can connect a model under Administration, AI settings.")
        } else setRun((r) => r && { ...r, state: "error", error: e.message })
      },
    )
  }
  const close = () => { ticket.current += 1; setRun(null) }
  const apply = () => {
    if (run?.state !== "done") return
    onApply(run.text)
    toast.success(autosave ? "Text replaced. Review and adjust it." : "Text replaced. Save to keep it.")
    close()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={button} type="button" size="icon-xs" variant="ghost" aria-label="Writing help" title={title} disabled={empty || tooLong}>
            <Sparkles />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {ACTIONS.map((a) => (
            <DropdownMenuItem key={a.label} onSelect={() => start(a, value)}>{a.label}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={!!run} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-3xl" onCloseAutoFocus={(e) => { e.preventDefault(); button.current?.focus() }}>
          <DialogHeader>
            <DialogTitle>{run?.action.label}</DialogTitle>
          </DialogHeader>
          {run && (
            <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto scroll-thin text-[13px] lg:grid-cols-2">
              <Column heading="Original">{run.original}</Column>
              <Column heading="Suggestion">
                {run.state === "pending" ? <Loading className="p-0" /> : run.state === "error" ? (
                  <div className="space-y-2">
                    <p role="alert" className="text-alarm">{run.error}</p>
                    <Button size="xs" variant="outline" onClick={() => start(run.action, run.original)}>Try again</Button>
                  </div>
                ) : run.text}
              </Column>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={close}>Discard</Button>
            <Button onClick={apply} disabled={run?.state !== "done"}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Column({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 text-[12px] font-medium text-ink-3">{heading}</div>
      <div className="rounded-md border bg-surface px-3 py-2 whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{children}</div>
    </div>
  )
}
