import { useEffect, useRef, type KeyboardEvent } from "react"
import { Bot, Maximize2, MessageSquarePlus, Minimize2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { AssistantChat, HistoryMenu } from "./chat"
import { useAssistant, useAssistantState } from "./provider"

/** Round button in the bottom-right corner that opens the assistant window. */
export function AssistantLauncher() {
  const { allowed, open, returnFocus } = useAssistantState()
  const { openAssistant } = useAssistant()
  const ref = useRef<HTMLButtonElement>(null)
  const visible = allowed && !open
  useEffect(() => {
    if (visible && returnFocus.current) { returnFocus.current = false; ref.current?.focus() }
  }, [visible, returnFocus])
  if (!visible) return null
  return (
    <button ref={ref} type="button" data-tour="welcome.assistant" aria-label="Open assistant" aria-expanded={open} onClick={() => openAssistant()}
      className="fixed right-5 bottom-5 z-40 flex size-12 items-center justify-center rounded-full bg-petrol text-white shadow-lg outline-none hover:bg-petrol/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 print:hidden">
      <Bot className="size-5" />
    </button>
  )
}

/** The floating, non-modal chat window. It only shows the state of the provider; closing it stops nothing. */
export function AssistantWindow() {
  const { allowed, open, expanded, setExpanded, dismiss } = useAssistantState()
  if (!allowed || !open) return null
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Escape that a menu or dialog inside already handled (or that came through a portal) must not close the window
    if (e.key === "Escape" && !e.defaultPrevented && e.currentTarget.contains(e.target as Node)) {
      e.stopPropagation()
      dismiss()
    }
  }
  return (
    <div role="dialog" aria-label="Assistant" data-assistant-window="" onKeyDown={onKeyDown}
      className={cn(
        "fixed right-4 z-40 flex max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xl print:hidden",
        expanded ? "top-[72px] bottom-4 w-[760px]" : "bottom-4 h-[560px] max-h-[calc(100vh-32px)] w-[400px]",
      )}>
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        <Bot className="mx-1.5 size-4 text-petrol" />
        <h2 className="mr-auto text-[14px] font-semibold text-ink">Assistant</h2>
        <HistoryMenu />
        <NewConversation />
        <Button variant="ghost" size="icon-sm" aria-label={expanded ? "Shrink assistant" : "Expand assistant"} title={expanded ? "Shrink assistant" : "Expand assistant"}
          onClick={() => setExpanded(!expanded)}>
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close assistant" title="Close assistant" onClick={dismiss}><X /></Button>
      </header>
      <AssistantChat />
    </div>
  )
}

function NewConversation() {
  const { busy, startNew } = useAssistantState()
  return (
    <Button variant="ghost" size="icon-sm" aria-label="New conversation" title="New conversation" disabled={busy} onClick={startNew}><MessageSquarePlus /></Button>
  )
}
