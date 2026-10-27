import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowUp, Bot, FileText, MessageSquarePlus, Pencil, Search, Square, ThumbsDown, ThumbsUp, Trash2, Wrench } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Pill } from "@/components/common/basics"
import { Confirm, NO_IMAGES } from "@/components/common/collab"
import { useAuth } from "@/hooks/useAuth"
import { api, postStream } from "@/lib/api"
import { fromNow } from "@/lib/format"
import type { ChatMessage, ChatSource } from "@/lib/types"
import { cn } from "@/lib/utils"

interface ConvSummary { id: number; title: string; updated_at: string; context: { label?: string } | null }
interface AIStatus { ready: boolean; enabled: boolean; chat_model: string | null; embedding_model: string | null; semantic_search: boolean; index: { chunks: number; embedded: number } }

const EXAMPLES = [
  "Which policy says we need multi-factor authentication?",
  "Do we have a guideline for backups and restore tests?",
  "Did we already answer requirement 3.2.1 for ATS, and what was the gap?",
  "What are our incident reporting deadlines in Germany and the Netherlands?",
  "Which high-priority action plan items are overdue?",
  "What does § 30 BSIG require for supply chain security?",
]

const TOOL_LABEL: Record<string, string> = {
  search_knowledge: "Searched",
  get_requirement_status: "Looked up assessment answers",
  list_open_items: "Listed open items",
  get_assessment_overview: "Read the assessment overview",
  get_legal_provision: "Read law text",
}

function toolText(t: { tool?: string; name?: string; args: Record<string, unknown> }) {
  const name = t.tool ?? t.name ?? ""
  const arg = Object.values(t.args ?? {}).filter((v) => typeof v === "string" || typeof v === "boolean").join(", ")
  return `${TOOL_LABEL[name] ?? name}${arg ? `: ${arg}` : ""}`
}

/** Renders the answer and turns [n] citations into links to the source. */
function AnswerBody({ text, sources }: { text: string; sources: ChatSource[] }) {
  const byN = useMemo(() => new Map(sources.map((s) => [s.n, s])), [sources])
  const withLinks = text.replace(/\[(\d{1,2})\](?!\()/g, (m, n) => (byN.has(Number(n)) ? `[${n}](#src-${n})` : m))
  return (
    <div className="prose-md text-[14px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        {...NO_IMAGES}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("#src-")) {
              const s = byN.get(Number(href.slice(5)))
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    {s?.url ? (
                      <Link to={s.url} className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] bg-petrol-50 px-1 align-[1px] font-mono text-[11px] font-medium text-petrol no-underline hover:bg-petrol hover:text-white">{children}</Link>
                    ) : <span className="mx-0.5 rounded-[4px] bg-muted px-1 font-mono text-[11px]">{children}</span>}
                  </TooltipTrigger>
                  {s && <TooltipContent className="max-w-sm">{s.title}</TooltipContent>}
                </Tooltip>
              )
            }
            return href?.startsWith("/") && !href.startsWith("//") ? <Link to={href}>{children}</Link> : <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
          },
        }}
      >
        {withLinks}
      </ReactMarkdown>
    </div>
  )
}

function Sources({ sources }: { sources: ChatSource[] }) {
  if (!sources.length) return null
  return (
    <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
      {sources.map((s) => (
        <Link key={s.n} to={s.url ?? "#"} className="group flex min-w-0 gap-2 rounded-md border bg-surface px-2.5 py-1.5 hover:border-petrol/50">
          <span className="mt-0.5 font-mono text-[11px] text-petrol">[{s.n}]</span>
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-medium text-ink group-hover:text-petrol">{s.title}</span>
            <span className="block truncate text-[11.5px] text-ink-3">{s.type.replace("_", " ")}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}

export default function AssistantPage() {
  const { id } = useParams()
  const convId = id ? Number(id) : null
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { canGlobal } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [tools, setTools] = useState<string[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const context = (location.state as { context?: { type: string; id: number; label: string } } | null)?.context

  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<AIStatus>("/ai/status") })
  const convs = useQuery({ queryKey: ["conversations"], queryFn: () => api.get<ConvSummary[]>("/ai/conversations") })
  const conv = useQuery({
    queryKey: ["conversation", convId],
    queryFn: () => api.get<{ id: number; title: string; messages: ChatMessage[] }>(`/ai/conversations/${convId}`),
    enabled: convId != null && !busy,
  })

  // reset only when switching conversations; never while a reply is streaming
  const busyRef = useRef(false)
  busyRef.current = busy
  useEffect(() => {
    if (convId == null && !busyRef.current) setMessages([])
  }, [convId])
  useEffect(() => {
    if (conv.data && !busyRef.current) setMessages(conv.data.messages)
  }, [conv.data])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    setInput("")
    setBusy(true)
    setTools([])
    setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "", sources: [], pending: true }])
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let newId = convId
    try {
      await postStream("/ai/chat", { content: q, conversation_id: convId, context: convId ? undefined : context }, (event, data) => {
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
      setBusy(false)
      setMessages((m) => m.map((x) => ({ ...x, pending: false })))
      qc.invalidateQueries({ queryKey: ["conversations"] })
      if (newId && newId !== convId) navigate(`/assistant/${newId}`, { replace: true })
      else qc.invalidateQueries({ queryKey: ["conversation", newId] })
    }
  }

  // ?q= from the command palette or "Ask assistant" buttons: send once
  const sentRef = useRef(false)
  useEffect(() => {
    const q = params.get("q")
    if (q && !sentRef.current && status.data?.ready) {
      sentRef.current = true
      setParams({}, { replace: true })
      send(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, status.data?.ready])

  const feedback = useMutation({
    mutationFn: ({ mid, value }: { mid: number; value: number }) => api.post(`/ai/messages/${mid}/feedback`, { value }),
    onSuccess: (_, v) => setMessages((m) => m.map((x) => (x.id === v.mid ? { ...x, feedback: v.value } : x))),
  })
  const del = useMutation({
    mutationFn: (cid: number) => api.del(`/ai/conversations/${cid}`),
    onSuccess: (_, cid) => { qc.invalidateQueries({ queryKey: ["conversations"] }); if (cid === convId) navigate("/assistant") },
  })
  const rename = useMutation({
    mutationFn: ({ cid, title }: { cid: number; title: string }) => api.patch(`/ai/conversations/${cid}`, { title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  })

  const notReady = status.data && !status.data.ready

  return (
    <div className="flex h-[calc(100vh-56px)]">
      <aside className="hidden w-[260px] shrink-0 flex-col border-r bg-card md:flex">
        <div className="p-3">
          <Button className="w-full justify-start" variant="outline" onClick={() => navigate("/assistant")}><MessageSquarePlus /> New conversation</Button>
        </div>
        <ul className="flex-1 overflow-y-auto px-2 pb-3 scroll-thin">
          {(convs.data ?? []).map((c) => (
            <li key={c.id} className="group relative">
              {editing === c.id ? (
                <form className="px-1 py-1" onSubmit={(e) => { e.preventDefault(); if (editTitle.trim()) rename.mutate({ cid: c.id, title: editTitle.trim() }); setEditing(null) }}>
                  <input autoFocus value={editTitle} onChange={(e) => setEditTitle(e.target.value)} onBlur={() => setEditing(null)}
                    onKeyDown={(e) => { if (e.key === "Escape") setEditing(null) }}
                    aria-label="Conversation title" className="h-8 w-full rounded-md border bg-surface px-2 text-[13px] outline-none focus:border-petrol" />
                </form>
              ) : (
              <Link to={`/assistant/${c.id}`} className={cn("block rounded-md px-2.5 py-2 pr-14 hover:bg-muted", c.id === convId && "bg-muted")}>
                <div className="truncate text-[13px] text-ink">{c.title}</div>
                <div className="text-[11.5px] text-ink-3">{fromNow(c.updated_at)}</div>
              </Link>
              )}
              <div className={cn("absolute top-2 right-1.5 hidden gap-0.5", editing !== c.id && "group-hover:flex")}>
                <button aria-label="Rename" className="rounded p-1 text-ink-3 hover:bg-background hover:text-ink"
                  onClick={() => { setEditing(c.id); setEditTitle(c.title) }}>
                  <Pencil className="size-3.5" />
                </button>
                <Confirm title="Delete this conversation?" onConfirm={() => del.mutate(c.id)}
                  trigger={<button aria-label="Delete" className="rounded p-1 text-ink-3 hover:bg-background hover:text-alarm"><Trash2 className="size-3.5" /></button>} />
              </div>
            </li>
          ))}
          {convs.data?.length === 0 && <li className="px-2.5 py-2 text-[12.5px] text-ink-3">Your conversations appear here. They are private to you.</li>}
        </ul>
        {status.data && (
          <div className="border-t px-3 py-2.5 text-[11.5px] text-ink-3">
            {status.data.ready ? <>Model <span className="font-mono">{status.data.chat_model}</span>{status.data.semantic_search && <>, semantic search on ({status.data.index.embedded}/{status.data.index.chunks} indexed)</>}</> : "Assistant not configured"}
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin">
          <div className="mx-auto w-full max-w-[820px] px-6 py-6">
            {notReady && (
              <div className="mb-6 rounded-md border border-brass/40 bg-brass-50 p-4 text-[13.5px]">
                <div className="font-medium text-ink">The assistant is not set up yet.</div>
                <div className="mt-1 text-ink-2">
                  It needs an OpenAI-compatible endpoint (for example Azure OpenAI, a LiteLLM gateway, vLLM or Ollama).
                  {canGlobal("settings.manage") ? <> Configure it under <Link className="text-petrol underline" to="/admin/ai">Administration, AI assistant</Link>.</> : " Ask an administrator to configure it."}
                </div>
              </div>
            )}
            {messages.length === 0 && !notReady && (
              <div className="pt-[8vh]">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-md bg-sidebar text-[#3fb0b8]"><Bot className="size-5" /></div>
                  <div>
                    <h1 className="text-[20px] font-semibold text-ink">Ask about your NIS-2 programme</h1>
                    <p className="text-[13.5px] text-ink-3">Answers come from documents, assessment answers, the action plan, tasks and the law texts you have access to, with sources.</p>
                  </div>
                </div>
                {context && <div className="mt-5"><Pill tone="petrol">Context: {context.label}</Pill></div>}
                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  {EXAMPLES.map((e) => (
                    <button key={e} onClick={() => send(e)} className="rounded-md border bg-card px-3.5 py-3 text-left text-[13.5px] text-ink-2 hover:border-petrol/50 hover:text-ink">
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-6">
              {messages.map((m, i) => m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg bg-sidebar px-3.5 py-2.5 text-[14px] whitespace-pre-wrap text-white">{m.content}</div>
                </div>
              ) : (
                <div key={i} className="flex gap-3">
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-petrol-50 text-petrol"><Bot className="size-4" /></div>
                  <div className="min-w-0 flex-1">
                    {m.pending && !m.content && (
                      <div className="space-y-1 text-[13px] text-ink-3">
                        {(i === messages.length - 1 ? tools : []).map((t, k) => <div key={k} className="flex items-center gap-1.5"><Wrench className="size-3.5" /> {t}</div>)}
                        <div className="flex items-center gap-1.5"><Search className="size-3.5 animate-pulse" /> {m.sources?.length ? `Reading ${m.sources.length} sources…` : "Searching…"}</div>
                      </div>
                    )}
                    {m.content && <AnswerBody text={m.content} sources={m.sources ?? []} />}
                    {!m.pending && m.tool_trace && m.tool_trace.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">{m.tool_trace.map((t, k) => <Pill key={k} tone="outline"><Wrench className="size-3" /> {toolText(t)}</Pill>)}</div>
                    )}
                    {!m.pending && <Sources sources={m.sources ?? []} />}
                    {!m.pending && m.id && (
                      <div className="mt-2 flex gap-1 text-ink-3">
                        <button aria-label="Helpful" className={cn("rounded p-1 hover:bg-muted", m.feedback === 1 && "text-petrol")} onClick={() => feedback.mutate({ mid: m.id!, value: 1 })}><ThumbsUp className="size-3.5" /></button>
                        <button aria-label="Not helpful" className={cn("rounded p-1 hover:bg-muted", m.feedback === -1 && "text-alarm")} onClick={() => feedback.mutate({ mid: m.id!, value: -1 })}><ThumbsDown className="size-3.5" /></button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t bg-background">
          <form className="mx-auto flex w-full max-w-[820px] items-end gap-2 px-6 py-4" onSubmit={(e) => { e.preventDefault(); send(input) }}>
            <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} disabled={!!notReady}
              placeholder="Ask a question, e.g. “Which documents cover supplier security?”"
              className="max-h-48 min-h-[52px] resize-none bg-card"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input) } }} />
            {busy ? (
              <Button type="button" size="icon-lg" variant="outline" aria-label="Stop" onClick={() => abortRef.current?.abort()}><Square /></Button>
            ) : (
              <Button type="submit" size="icon-lg" aria-label="Send" disabled={!input.trim() || !!notReady}><ArrowUp /></Button>
            )}
          </form>
          <p className="mx-auto -mt-2 max-w-[820px] px-6 pb-3 text-[11.5px] text-ink-3">
            <FileText className="mr-1 inline size-3" />Check important answers against the cited sources. This is not legal advice.
          </p>
        </div>
      </div>
    </div>
  )
}
