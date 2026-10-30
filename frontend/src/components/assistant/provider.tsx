import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useAuth } from "@/hooks/useAuth"
import { ApiError, api, postStream } from "@/lib/api"
import type { ChatMessage } from "@/lib/types"

export interface AssistantContext { type: string; id: number; label: string }
export interface OpenAssistantOptions { question?: string; context?: AssistantContext; conversationId?: number; expanded?: boolean }
export interface AIStatus { ready: boolean; enabled: boolean; chat_model: string | null; embedding_model: string | null; semantic_search: boolean; index: { chunks: number; embedded: number } }

interface AssistantApi { openAssistant: (opts?: OpenAssistantOptions) => void; close: () => void; open: boolean; busy: boolean }

interface AssistantState {
  allowed: boolean
  open: boolean
  expanded: boolean
  setExpanded: (v: boolean) => void
  /** Closes the window and hands the focus back to the launcher. */
  dismiss: () => void
  returnFocus: React.RefObject<boolean>
  focusTick: number
  convId: number | null
  context: AssistantContext | undefined
  messages: ChatMessage[]
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  input: string
  setInput: (v: string) => void
  busy: boolean
  tools: string[]
  status: AIStatus | undefined
  send: (text: string) => Promise<void>
  stop: () => void
  startNew: () => void
  selectConversation: (id: number) => void
}

const STORAGE_KEY = "nis2-assistant"
const ApiContext = createContext<AssistantApi | null>(null)
const StateContext = createContext<AssistantState | null>(null)

function loadStored() {
  try {
    const s = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null")
    return { open: s?.open === true, expanded: s?.expanded === true, conversationId: Number.isInteger(s?.conversationId) ? (s.conversationId as number) : null }
  } catch {
    return { open: false, expanded: false, conversationId: null }
  }
}

const TOOL_LABEL: Record<string, string> = {
  search_knowledge: "Searched",
  get_requirement_status: "Looked up assessment answers",
  list_open_items: "Listed open items",
  get_assessment_overview: "Read the assessment overview",
  get_legal_provision: "Read law text",
}

export function toolText(t: { tool?: string; name?: string; args: Record<string, unknown> }) {
  const name = t.tool ?? t.name ?? ""
  const arg = Object.values(t.args ?? {}).filter((v) => typeof v === "string" || typeof v === "boolean").join(", ")
  return `${TOOL_LABEL[name] ?? name}${arg ? `: ${arg}` : ""}`
}

/**
 * Owns the window state and the running chat. The stream lives here, not in the window, so a reply keeps going
 * when the window is closed or the page behind it changes.
 */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const { canAny } = useAuth()
  const allowed = canAny("ai.use")
  const stored = useRef(loadStored()).current
  const [open, setOpen] = useState(stored.open)
  const [expanded, setExpanded] = useState(stored.expanded)
  const [convId, setConvId] = useState<number | null>(stored.conversationId)
  const [context, setContext] = useState<AssistantContext | undefined>()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [tools, setTools] = useState<string[]>([])
  const [pending, setPending] = useState<string | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const returnFocus = useRef(false)
  const busyRef = useRef(false)
  const lastSentRef = useRef<string | null>(null)
  // The last question from an asking button and the conversation it started (null until the reply names it). Set
  // synchronously on the click, so a repeat of the same ask, e.g. a double click, finds it even when the first
  // reply has already finished and the busy flag is down again.
  const askRef = useRef<{ key: string; convId: number | null } | null>(null)
  const convIdRef = useRef(convId)
  const contextRef = useRef(context)
  const allowedRef = useRef(allowed)
  allowedRef.current = allowed
  contextRef.current = context

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ open, expanded, conversationId: convId })) } catch { /* no storage: start closed next time */ }
  }, [open, expanded, convId])

  // Read by the toast placement in index.css, so toasts stay clear of the window.
  useEffect(() => {
    const root = document.documentElement
    if (open && allowed) root.dataset.assistant = expanded ? "expanded" : "compact"
    else delete root.dataset.assistant
    return () => { delete root.dataset.assistant }
  }, [open, expanded, allowed])

  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<AIStatus>("/ai/status"), enabled: allowed })
  const conv = useQuery({
    queryKey: ["conversation", convId],
    queryFn: () => api.get<{ id: number; title: string; messages: ChatMessage[] }>(`/ai/conversations/${convId}`),
    enabled: allowed && convId != null && !busy,
  })

  const changeConversation = useCallback((id: number | null) => {
    if (convIdRef.current === id) return
    convIdRef.current = id
    setConvId(id)
    setMessages([])
    setTools([])
    setContext(undefined)
  }, [])

  // never replace the messages while a reply is streaming
  useEffect(() => {
    if (conv.data && !busyRef.current) setMessages(conv.data.messages)
  }, [conv.data])
  // a stored or linked conversation that no longer exists opens as a new one
  useEffect(() => {
    if (conv.error instanceof ApiError && conv.error.status === 404) changeConversation(null)
  }, [conv.error, changeConversation])

  const send = useCallback(async (text: string) => {
    const q = text.trim()
    if (!q || busyRef.current) return
    busyRef.current = true
    lastSentRef.current = q
    setInput("")
    setBusy(true)
    setTools([])
    setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "", sources: [], pending: true }])
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const cid = convIdRef.current
    let newId = cid
    try {
      await postStream("/ai/chat", { content: q, conversation_id: cid, context: cid ? undefined : contextRef.current }, (event, data) => {
        if (event === "meta") newId = data.conversation_id
        else if (event === "sources") setMessages((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], sources: data.sources }; return c })
        else if (event === "tool") setTools((t) => [...t, toolText(data)])
        else if (event === "delta") setMessages((m) => { const c = [...m]; const last = c[c.length - 1]; c[c.length - 1] = { ...last, content: last.content + data.text }; return c })
        else if (event === "error") setMessages((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], content: `**The assistant could not answer.** ${data.message}`, pending: false }; return c })
        else if (event === "saved") setMessages((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], id: data.message_id, pending: false }; return c })
      }, ctrl.signal)
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.error(e.message)
    } finally {
      busyRef.current = false
      setBusy(false)
      // the ask's own send names its conversation; one that ended without one can be asked again
      const ask = askRef.current
      if (ask && ask.convId === null && cid === null) {
        if (newId) ask.convId = newId
        else askRef.current = null
      }
      setMessages((m) => m.map((x) => ({ ...x, pending: false })))
      qc.invalidateQueries({ queryKey: ["conversations"] })
      if (newId && newId !== cid) { convIdRef.current = newId; setConvId(newId); setContext(undefined) }
      else qc.invalidateQueries({ queryKey: ["conversation", newId] })
    }
  }, [qc])

  // a question from an asking button: send it once the AI is known to be ready, else leave it in the input
  useEffect(() => {
    if (!pending || !(status.data || status.isError)) return
    setPending(null)
    if (status.data?.ready && !busyRef.current) void send(pending)
    else {
      askRef.current = null
      setInput(pending)
    }
  }, [pending, status.data, status.isError, send])

  const openAssistant = useCallback((opts: OpenAssistantOptions = {}) => {
    if (!allowedRef.current) return
    setOpen(true)
    if (opts.expanded !== undefined) setExpanded(opts.expanded)
    setFocusTick((t) => t + 1)
    if (busyRef.current) {
      // stay on the streaming conversation; the question waits in the input, unless it is the one being answered
      if (opts.question && opts.question.trim() !== lastSentRef.current) setInput(opts.question)
      return
    }
    const askKey = opts.question && opts.conversationId == null
      ? JSON.stringify([opts.question.trim(), opts.context?.type ?? null, opts.context?.id ?? null])
      : null
    // the same ask again while its conversation is still the shown one: show it, do not ask a second time
    if (askKey && askRef.current?.key === askKey && askRef.current.convId === convIdRef.current) return
    if (askKey) askRef.current = { key: askKey, convId: null }
    if (opts.conversationId != null) changeConversation(opts.conversationId)
    else if (opts.question || opts.context) {
      changeConversation(null)
      setMessages([])
      setContext(opts.context)
      setInput("")
    }
    if (opts.question) setPending(opts.question)
  }, [changeConversation])

  const close = useCallback(() => setOpen(false), [])
  const dismiss = useCallback(() => { returnFocus.current = true; setOpen(false) }, [])
  const stop = useCallback(() => abortRef.current?.abort(), [])
  // keeps the draft in the input; clears even without an id, e.g. after a first message that failed or was stopped
  const startNew = useCallback(() => {
    convIdRef.current = null
    setConvId(null)
    setMessages([])
    setTools([])
    setContext(undefined)
  }, [])

  const publicValue = useMemo(() => ({ openAssistant, close, open, busy }), [openAssistant, close, open, busy])
  const state: AssistantState = {
    allowed, open, expanded, setExpanded, dismiss, returnFocus, focusTick, convId, context, messages, setMessages, input, setInput,
    busy, tools, status: status.data, send, stop, startNew, selectConversation: changeConversation,
  }
  return (
    <ApiContext.Provider value={publicValue}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ApiContext.Provider>
  )
}

export function useAssistant(): AssistantApi {
  const v = useContext(ApiContext)
  if (!v) throw new Error("useAssistant needs an AssistantProvider")
  return v
}

/** The full chat state, for the window and its body. */
export function useAssistantState(): AssistantState {
  const v = useContext(StateContext)
  if (!v) throw new Error("useAssistantState needs an AssistantProvider")
  return v
}
