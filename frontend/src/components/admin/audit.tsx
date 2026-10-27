import { Fragment, useEffect, useState } from "react"
import { Link } from "react-router"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronLeft, ChevronRight, ChevronRight as Caret, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Code, Empty, EntityTag, ErrorState, Loading } from "@/components/common/basics"
import { Combo, Field, OptionSelect } from "@/components/common/fields"
import { useEntities, useUsers } from "@/hooks/useRefData"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

interface AuditEvent {
  id: number
  at: string
  actor: string | null
  actor_id: number | null
  action: string
  target_type: string | null
  target_id: number | null
  target_label: string | null
  entity_id: number | null
  details: unknown
  ip: string | null
}

const ACTIONS = [
  "create", "update", "delete", "restore", "copy", "bulk_update", "link", "unlink", "new_version", "download", "acknowledge", "export", "import",
  "login", "login_failed", "logout", "password_changed", "password_reset", "api_token_created", "target_changed", "reindex",
]
const TARGETS = [
  "action_item", "activity", "answer", "assessment", "chapter", "document", "entity", "gate", "incident", "project", "raci", "raid",
  "regulation", "requirement", "role", "round", "settings", "stakeholder", "task", "user", "work_package",
]
const PAGE = 50

function targetUrl(e: AuditEvent): string | null {
  if (e.target_id == null || e.action === "delete") return null
  switch (e.target_type) {
    case "document": return `/documents/${e.target_id}`
    case "incident": return `/incidents/${e.target_id}`
    case "work_package": return `/work-packages/${e.target_id}`
    case "task": return `/tasks?task=${e.target_id}`
    case "action_item": return `/action-plan?item=${e.target_id}`
    case "requirement": return `/catalog/${e.target_id}`
    case "assessment": return `/assessments/${e.target_id}`
    case "entity": return `/entities/${e.target_id}`
    case "project": return `/projects/${e.target_id}`
    case "regulation": return `/regulations/${e.target_id}`
    default: return null
  }
}

const label = (s: string) => s.replace(/_/g, " ")

export function AuditSection() {
  const users = useUsers()
  const entities = useEntities()
  const [qInput, setQInput] = useState("")
  const [q, setQ] = useState("")
  const [action, setAction] = useState<string | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [actor, setActor] = useState<number | null>(null)
  const [since, setSince] = useState("")
  const [until, setUntil] = useState("")
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<Set<number>>(new Set())
  useEffect(() => { const t = setTimeout(() => setQ(qInput.trim()), 300); return () => clearTimeout(t) }, [qInput])
  useEffect(() => setOffset(0), [q, action, target, actor, since, until])

  const data = useQuery({
    queryKey: ["audit", { q, action, target, actor, since, until, offset }],
    queryFn: () => api.get<{ total: number; items: AuditEvent[] }>("/audit", {
      q, action, target_type: target, actor_id: actor,
      since: since ? new Date(`${since}T00:00:00`).toISOString() : null,
      until: until ? new Date(`${until}T23:59:59`).toISOString() : null,
      offset, limit: PAGE,
    }),
    placeholderData: keepPreviousData,
  })
  const entityCode = (id: number | null) => (id != null ? entities.data?.find((e) => e.id === id) : null)
  const total = data.data?.total ?? 0
  const filters = !!(qInput || action || target || actor || since || until)

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))_auto_auto]">
        <Field label="Search">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
            <Input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Object or user" className="pl-8" />
          </div>
        </Field>
        <Field label="Action">
          <OptionSelect value={action} onChange={setAction} allowNone noneLabel="All actions" placeholder="All actions" options={ACTIONS.map((a) => ({ value: a, label: label(a) }))} />
        </Field>
        <Field label="Object type">
          <OptionSelect value={target} onChange={setTarget} allowNone noneLabel="All types" placeholder="All types" options={TARGETS.map((a) => ({ value: a, label: label(a) }))} />
        </Field>
        <Field label="User">
          <Combo value={actor} onChange={setActor} placeholder="All users" items={(users.data ?? []).map((u) => ({ value: u.id, label: u.display_name, hint: u.email }))} />
        </Field>
        <Field label="From"><Input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="w-[150px]" /></Field>
        <Field label="To"><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="w-[150px]" /></Field>
      </div>
      {filters && (
        <Button size="sm" variant="ghost" className="mb-2" onClick={() => { setQInput(""); setAction(null); setTarget(null); setActor(null); setSince(""); setUntil("") }}>
          <X /> Clear filters
        </Button>
      )}

      <div className="rounded-md border bg-card">
        {data.isLoading ? <Loading /> : data.error ? <ErrorState error={data.error} className="m-4" /> : !data.data?.items.length ? (
          <Empty title="No events match">Change or clear the filters.</Empty>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-b text-left text-[12px] text-ink-3">
                  <th className="w-8" />
                  <th className="px-2 py-2 font-medium">Time</th>
                  <th className="px-2 py-2 font-medium">User</th>
                  <th className="px-2 py-2 font-medium">Action</th>
                  <th className="px-2 py-2 font-medium">Object</th>
                  <th className="px-2 py-2 font-medium">Entity</th>
                  <th className="px-2 py-2 pr-4 font-medium">IP address</th>
                </tr>
              </thead>
              <tbody className={cn(data.isFetching && "opacity-70")}>
                {data.data.items.map((e) => {
                  const hasDetails = e.details != null && !(typeof e.details === "object" && Object.keys(e.details as object).length === 0)
                  const isOpen = open.has(e.id)
                  const url = targetUrl(e)
                  const ent = entityCode(e.entity_id)
                  return (
                    <Fragment key={e.id}>
                      <tr className={cn("border-b align-top last:border-0", isOpen && "bg-muted/40")}>
                        <td className="py-1.5 pl-2">
                          {hasDetails && (
                            <button type="button" aria-expanded={isOpen} aria-label={isOpen ? "Hide details" : "Show details"}
                              onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n })}
                              className="rounded p-0.5 text-ink-3 hover:text-ink">
                              {isOpen ? <ChevronDown className="size-4" /> : <Caret className="size-4" />}
                            </button>
                          )}
                        </td>
                        <td className="tabular px-2 py-1.5 whitespace-nowrap text-ink-2">{fmtDateTime(e.at)}</td>
                        <td className="px-2 py-1.5 text-ink">{e.actor ?? <span className="text-ink-3">System</span>}</td>
                        <td className={cn("px-2 py-1.5", e.action === "delete" || e.action === "login_failed" ? "text-alarm" : "text-ink-2")}>{label(e.action)}</td>
                        <td className="px-2 py-1.5">
                          <span className="mr-1.5 text-[12px] text-ink-3">{e.target_type ? label(e.target_type) : ""}</span>
                          {url ? <Link to={url} className="text-ink hover:text-petrol">{e.target_label ?? `#${e.target_id}`}</Link> : <span className="text-ink">{e.target_label ?? (e.target_id ? `#${e.target_id}` : "")}</span>}
                        </td>
                        <td className="px-2 py-1.5">{ent ? <EntityTag code={ent.code} name={ent.name} /> : null}</td>
                        <td className="px-2 py-1.5 pr-4"><Code className="text-[12px] text-ink-3">{e.ip ?? ""}</Code></td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b bg-muted/40">
                          <td />
                          <td colSpan={6} className="px-2 pb-3">
                            <pre className="max-h-80 overflow-auto rounded-md border bg-surface p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2 scroll-thin">
                              {JSON.stringify(e.details, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && (
          <div className="flex items-center justify-between border-t px-3 py-2 text-[12.5px] text-ink-3">
            <span className="tabular">{offset + 1} to {Math.min(offset + PAGE, total)} of {total.toLocaleString("en")} events</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}><ChevronLeft /> Newer</Button>
              <Button size="sm" variant="outline" disabled={offset + PAGE >= total} onClick={() => setOffset((o) => o + PAGE)}>Older <ChevronRight /></Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
