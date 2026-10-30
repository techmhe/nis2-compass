import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowUp, Bot, FileText, History, Pencil, Search, Square, ThumbsDown, ThumbsUp, Trash2, Wrench } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Pill } from "@/components/common/basics"
import { Confirm, NO_IMAGES } from "@/components/common/collab"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fromNow } from "@/lib/format"
import type { ChatSource } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toolText, useAssistantState } from "./provider"

interface ConvSummary { id: number; title: string; updated_at: string; context: { label?: string } | null }

const EXAMPLES = [
  "Which policy says we need multi-factor authentication?",
  "Do we have a guideline for backups and restore tests?",
  "Did we already answer requirement 3.2.1 for ATS, and what was the gap?",
  "What are our incident reporting deadlines in Germany and the Netherlands?",
  "Which high-priority action plan items are overdue?",
  "What does § 30 BSIG require for supply chain security?",
]

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
    <div className="mt-3 grid gap-1.5 @lg:grid-cols-2">
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

/** The user's conversations, newest first, with rename and delete. */
export function HistoryMenu() {
  const qc = useQueryClient()
  const { convId, busy, status, selectConversation, startNew } = useAssistantState()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const convs = useQuery({ queryKey: ["conversations"], queryFn: () => api.get<ConvSummary[]>("/ai/conversations"), enabled: open })
  const del = useMutation({
    mutationFn: (cid: number) => api.del(`/ai/conversations/${cid}`),
    onSuccess: (_, cid) => {
      qc.invalidateQueries({ queryKey: ["conversations"] })
      qc.removeQueries({ queryKey: ["conversation", cid] })
      if (cid === convId) startNew()
    },
  })
  const rename = useMutation({
    mutationFn: ({ cid, title }: { cid: number; title: string }) => api.patch(`/ai/conversations/${cid}`, { title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  })
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null) }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Conversation history" title="Conversation history" disabled={busy}><History /></Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex max-h-[min(420px,60vh)] w-[320px] flex-col p-0">
        <ul className="flex-1 overflow-y-auto p-2 scroll-thin">
          {(convs.data ?? []).map((c) => (
            <li key={c.id} className="group relative">
              {editing === c.id ? (
                <form className="px-1 py-1" onSubmit={(e) => { e.preventDefault(); if (editTitle.trim()) rename.mutate({ cid: c.id, title: editTitle.trim() }); setEditing(null) }}>
                  <input autoFocus value={editTitle} onChange={(e) => setEditTitle(e.target.value)} onBlur={() => setEditing(null)}
                    onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(null) } }}
                    aria-label="Conversation title" className="h-8 w-full rounded-md border bg-surface px-2 text-[13px] outline-none focus:border-petrol" />
                </form>
              ) : (
                <button className={cn("block w-full rounded-md px-2.5 py-2 pr-14 text-left hover:bg-muted", c.id === convId && "bg-muted")}
                  onClick={() => { selectConversation(c.id); setOpen(false) }}>
                  <div className="truncate text-[13px] text-ink">{c.title}</div>
                  <div className="text-[11.5px] text-ink-3">{fromNow(c.updated_at)}</div>
                </button>
              )}
              <div className={cn("absolute top-2 right-1.5 hidden gap-0.5 group-focus-within:flex", editing !== c.id && "group-hover:flex")}>
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
        {status && (
          <div className="border-t px-3 py-2.5 text-[11.5px] text-ink-3">
            {status.ready ? <>Model <span className="font-mono">{status.chat_model}</span>{status.semantic_search && <>, semantic search on ({status.index.embedded}/{status.index.chunks} indexed)</>}</> : "Assistant not configured"}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Messages, input and notices of the assistant. */
export function AssistantChat() {
  const { canGlobal } = useAuth()
  const { messages, setMessages, input, setInput, busy, tools, status, context, send, stop, focusTick } = useAssistantState()
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const notReady = status && !status.ready

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])
  useEffect(() => {
    if (focusTick > 0) inputRef.current?.focus()
  }, [focusTick])

  const feedback = useMutation({
    mutationFn: ({ mid, value }: { mid: number; value: number }) => api.post(`/ai/messages/${mid}/feedback`, { value }),
    onSuccess: (_, v) => setMessages((m) => m.map((x) => (x.id === v.mid ? { ...x, feedback: v.value } : x))),
  })

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin">
        <div className="w-full px-4 py-4 @lg:px-6">
          {notReady && (
            <div className="mb-4 rounded-md border border-brass/40 bg-brass-50 p-3.5 text-[13.5px]">
              <div className="font-medium text-ink">The assistant is not set up yet.</div>
              <div className="mt-1 text-ink-2">
                It needs an OpenAI-compatible endpoint (for example Azure OpenAI, a LiteLLM gateway, vLLM or Ollama).
                {canGlobal("settings.manage") ? <> Configure it under <Link className="text-petrol underline" to="/admin/ai">Administration, AI assistant</Link>.</> : " Ask an administrator to configure it."}
              </div>
            </div>
          )}
          {messages.length === 0 && !notReady && (
            <div className="pt-2">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-sidebar text-[#3fb0b8]"><Bot className="size-5" /></div>
                <div>
                  <h2 className="text-[16px] font-semibold text-ink">Ask about your NIS-2 programme</h2>
                  <p className="text-[12.5px] text-ink-3">Answers come from documents, assessment answers, the action plan, tasks and the law texts you have access to, with sources.</p>
                </div>
              </div>
              {context && <div className="mt-4"><Pill tone="petrol">Context: {context.label}</Pill></div>}
              <div className="mt-4 grid gap-2 @lg:grid-cols-2">
                {EXAMPLES.map((e) => (
                  <button key={e} onClick={() => send(e)} className="rounded-md border bg-card px-3 py-2.5 text-left text-[13px] text-ink-2 hover:border-petrol/50 hover:text-ink">
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-5">
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
        <form className="flex w-full items-end gap-2 px-4 py-3 @lg:px-6" onSubmit={(e) => { e.preventDefault(); send(input) }}>
          <Textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} rows={2} disabled={!!notReady}
            aria-label="Message to the assistant"
            placeholder="Ask a question, e.g. “Which documents cover supplier security?”"
            className="max-h-48 min-h-[52px] resize-none bg-card"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input) } }} />
          {busy ? (
            <Button type="button" size="icon-lg" variant="outline" aria-label="Stop" onClick={stop}><Square /></Button>
          ) : (
            <Button type="submit" size="icon-lg" aria-label="Send" disabled={!input.trim() || !!notReady}><ArrowUp /></Button>
          )}
        </form>
        <p className="w-full px-4 pb-3 text-[11.5px] text-ink-3 @lg:px-6">
          <FileText className="mr-1 inline size-3" />Check important answers against the cited sources. This is not legal advice.
        </p>
      </div>
    </div>
  )
}
