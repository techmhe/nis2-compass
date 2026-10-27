import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, KeyRound, PlugZap, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ErrorState, KV, Loading, Meter, Pill, Section } from "@/components/common/basics"
import { Field } from "@/components/common/fields"
import { api } from "@/lib/api"
import { pct } from "@/lib/format"
import { SwitchRow } from "./common"

interface AiSettings {
  enabled: boolean
  base_url: string | null
  has_api_key: boolean
  chat_model: string | null
  embedding_model: string | null
  temperature: number
  max_context_chunks: number
  max_tokens: number
  use_tools: boolean
  system_prompt_extra: string
}
interface AiStatus { ready: boolean; enabled: boolean; chat_model: string | null; embedding_model: string | null; semantic_search: boolean; index: { chunks: number; embedded: number } }
interface TestResult { chat: { ok: boolean; reply?: string; error?: string } | null; embeddings: { ok: boolean; dimensions?: number; error?: string } | null }

export function AiSection() {
  const settings = useQuery({ queryKey: ["ai", "settings"], queryFn: () => api.get<AiSettings>("/ai/settings") })
  if (settings.isLoading) return <Loading />
  if (settings.error) return <ErrorState error={settings.error} />
  return <AiForm key={JSON.stringify(settings.data)} initial={settings.data!} />
}

function AiForm({ initial }: { initial: AiSettings }) {
  const qc = useQueryClient()
  const [f, setF] = useState(initial)
  const [apiKey, setApiKey] = useState("")
  const [clearKey, setClearKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<TestResult | null>(null)
  const status = useQuery({ queryKey: ["ai", "status"], queryFn: () => api.get<AiStatus>("/ai/status"), refetchInterval: 30_000 })
  const set = <K extends keyof AiSettings>(k: K, v: AiSettings[K]) => setF((s) => ({ ...s, [k]: v }))
  const dirty = JSON.stringify(f) !== JSON.stringify(initial) || !!apiKey || clearKey
  const urlChanged = (f.base_url?.trim() || null) !== (initial.base_url || null)
  const keyDropped = urlChanged && initial.has_api_key && !apiKey && !clearKey
  const embeddingChanged = (f.embedding_model || null) !== (initial.embedding_model || null)

  const save = useMutation({
    mutationFn: () => api.put<AiSettings>("/ai/settings", {
      enabled: f.enabled,
      base_url: f.base_url?.trim() || null,
      api_key: clearKey ? "" : apiKey ? apiKey : null,
      chat_model: f.chat_model?.trim() || null,
      embedding_model: f.embedding_model?.trim() || null,
      temperature: Number(f.temperature),
      max_context_chunks: Number(f.max_context_chunks),
      max_tokens: Number(f.max_tokens),
      use_tools: f.use_tools,
      system_prompt_extra: f.system_prompt_extra ?? "",
    }),
    onMutate: () => setError(null),
    onSuccess: (s) => {
      toast.success("AI settings saved")
      qc.setQueryData(["ai", "settings"], s)
      qc.invalidateQueries({ queryKey: ["ai", "status"] })
    },
    onError: (e: Error) => setError(e.message),
  })
  const runTest = useMutation({
    mutationFn: () => api.post<TestResult>("/ai/test"),
    onMutate: () => setTest(null),
    onSuccess: setTest,
    onError: (e: Error) => setTest({ chat: { ok: false, error: e.message }, embeddings: null }),
  })

  const idx = status.data?.index
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Section title="Connection">
          <SwitchRow title="Enable the AI assistant" description="When off, the assistant, AI summaries and drafting helpers are hidden for everyone.">
            <Switch checked={f.enabled} onCheckedChange={(v) => set("enabled", v)} aria-label="Enable the AI assistant" />
          </SwitchRow>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Base URL" htmlFor="ai-url" className="sm:col-span-2" hint="Any OpenAI-compatible endpoint, e.g. https://api.openai.com/v1, Azure OpenAI or a local vLLM / Ollama server">
              <Input id="ai-url" type="url" value={f.base_url ?? ""} onChange={(e) => set("base_url", e.target.value)} placeholder="https://…/v1" />
            </Field>
            <Field label="API key" htmlFor="ai-key" className="sm:col-span-2"
              hint={keyDropped ? <span className="text-amber">The base URL changed, so the stored key will be removed when you save. Enter the key for the new endpoint to replace it.</span> : clearKey ? "The stored key will be removed when you save." : initial.has_api_key ? "Leave empty to keep the stored key. The key is never shown again." : "Stored encrypted; it cannot be read back."}>
              <div className="flex items-center gap-2">
                <Input id="ai-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setClearKey(false) }}
                  placeholder={initial.has_api_key ? "••••••••  (key stored)" : "No key stored"} />
                {initial.has_api_key && !clearKey && (
                  <Pill tone="petrol" className="h-7"><KeyRound className="size-3" /> Key stored</Pill>
                )}
                {initial.has_api_key && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setClearKey((v) => !v); setApiKey("") }}>
                    {clearKey ? "Keep key" : "Remove key"}
                  </Button>
                )}
              </div>
            </Field>
            <Field label="Chat model" htmlFor="ai-chat">
              <Input id="ai-chat" value={f.chat_model ?? ""} onChange={(e) => set("chat_model", e.target.value)} placeholder="e.g. gpt-4.1-mini" />
            </Field>
            <Field label="Embedding model" htmlFor="ai-embed" hint={embeddingChanged ? <span className="text-amber">Changing it clears all embeddings; they are rebuilt by a reindex.</span> : "Optional; enables semantic search"}>
              <Input id="ai-embed" value={f.embedding_model ?? ""} onChange={(e) => set("embedding_model", e.target.value)} placeholder="e.g. text-embedding-3-small" />
            </Field>
          </div>
        </Section>

        <Section title="Behaviour">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Temperature" htmlFor="ai-temp" hint="0 to 2; low values give factual answers">
              <Input id="ai-temp" type="number" min={0} max={2} step={0.1} value={f.temperature} onChange={(e) => set("temperature", e.target.value as unknown as number)} />
            </Field>
            <Field label="Max context chunks" htmlFor="ai-chunks" hint="2 to 40 search results per question">
              <Input id="ai-chunks" type="number" min={2} max={40} value={f.max_context_chunks} onChange={(e) => set("max_context_chunks", e.target.value as unknown as number)} />
            </Field>
            <Field label="Max answer tokens" htmlFor="ai-tokens" hint="100 to 16,000">
              <Input id="ai-tokens" type="number" min={100} max={16000} step={100} value={f.max_tokens} onChange={(e) => set("max_tokens", e.target.value as unknown as number)} />
            </Field>
          </div>
          <SwitchRow title="Let the model use tools" description="The assistant may query assessments, the action plan and tasks itself, always limited to the asking user's permissions.">
            <Switch checked={f.use_tools} onCheckedChange={(v) => set("use_tools", v)} aria-label="Let the model use tools" />
          </SwitchRow>
          <Field label="Additional system prompt" htmlFor="ai-prompt" hint="Appended to the built-in instructions, e.g. company terminology or the preferred answer language">
            <Textarea id="ai-prompt" rows={4} maxLength={4000} value={f.system_prompt_extra ?? ""} onChange={(e) => set("system_prompt_extra", e.target.value)} />
          </Field>
        </Section>

        {error && <ErrorState error={error} />}
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={!dirty || save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</Button>
          {dirty && <Button type="button" variant="ghost" onClick={() => { setF(initial); setApiKey(""); setClearKey(false); setError(null) }}>Discard</Button>}
        </div>
      </form>

      <div className="space-y-5">
        <Section title="Test connection" actions={
          <Button size="xs" variant="outline" disabled={runTest.isPending || dirty} onClick={() => runTest.mutate()}><PlugZap /> {runTest.isPending ? "Testing…" : "Test connection"}</Button>
        }>
          {dirty ? <p className="text-[12.5px] text-ink-3">Save your changes first; the test uses the stored settings.</p> : !test && !runTest.isPending ? (
            <p className="text-[12.5px] text-ink-3">Sends a tiny request to the chat model and, if configured, the embedding model.</p>
          ) : runTest.isPending ? <Loading className="p-0" label="Contacting the endpoint" /> : test && (
            <ul className="space-y-2 text-[13px]">
              <TestLine label="Chat model" ok={test.chat?.ok} detail={test.chat?.ok ? `Replied “${test.chat.reply ?? ""}”` : test.chat?.error} />
              {test.embeddings
                ? <TestLine label="Embedding model" ok={test.embeddings.ok} detail={test.embeddings.ok ? `${test.embeddings.dimensions} dimensions` : test.embeddings.error} />
                : <li className="text-[12.5px] text-ink-3">No embedding model configured.</li>}
            </ul>
          )}
        </Section>
        <Section title="Status">
          {status.isLoading ? <Loading className="p-0" /> : status.error ? <ErrorState error={status.error} /> : status.data && (
            <>
              <KV label="Assistant">{status.data.ready ? <span className="text-petrol">Ready</span> : status.data.enabled ? <span className="text-amber">Enabled, not fully configured</span> : <span className="text-ink-3">Disabled</span>}</KV>
              <KV label="Chat model">{status.data.chat_model}</KV>
              <KV label="Semantic search">{status.data.semantic_search ? <span className="text-petrol">On</span> : <span className="text-ink-3">Off (keyword search only)</span>}</KV>
              {idx && (
                <div className="mt-2 border-t pt-3">
                  <div className="mb-1 flex justify-between text-[12.5px]">
                    <span className="text-ink-3">Embedded search chunks</span>
                    <span className="tabular text-ink-2">{idx.embedded.toLocaleString("en")} of {idx.chunks.toLocaleString("en")} ({pct(idx.chunks ? idx.embedded / idx.chunks : null)})</span>
                  </div>
                  <Meter value={idx.chunks ? idx.embedded / idx.chunks : 0} />
                  <p className="mt-2 text-[12px] text-ink-3">Missing embeddings are created in the background. Rebuild the whole index under System if the numbers do not grow.</p>
                </div>
              )}
            </>
          )}
        </Section>
      </div>
    </div>
  )
}

function TestLine({ label, ok, detail }: { label: string; ok?: boolean; detail?: string }) {
  return (
    <li className="flex gap-2">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-petrol" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-alarm" />}
      <div className="min-w-0">
        <div className="font-medium text-ink">{label}: {ok ? "working" : "failed"}</div>
        {detail && <div className="text-[12.5px] break-words text-ink-3">{detail}</div>}
      </div>
    </li>
  )
}
