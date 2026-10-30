import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { ExternalLink, Stamp, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Empty, EntityTag, ErrorState, KV, Loading, PageHeader, Pill, Section } from "@/components/common/basics"
import { Markdown } from "@/components/common/collab"
import { OptionSelect } from "@/components/common/fields"
import { DecisionButtons, useWithdraw } from "@/components/approvals/dialogs"
import {
  ApprovalStatePill, ManagementBodyFlag, requestState, targetTypeLabel, type Approval, type ApprovalSummary,
} from "@/components/approvals/shared"
import { api, ApiError } from "@/lib/api"
import { fmtDate, fmtDateTime, fromNow } from "@/lib/format"
import { cn } from "@/lib/utils"

type Mine = "waiting" | "requested" | "all"
const TABS: { key: Mine; label: string; hint: string }[] = [
  { key: "waiting", label: "Waiting for me", hint: "Requests you have to decide" },
  { key: "requested", label: "Requested by me", hint: "Requests you sent to others" },
  { key: "all", label: "All I can see", hint: "Every request on objects you have access to" },
]
const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "open", label: "Pending or changes requested" },
  { value: "decided", label: "Decided" },
  { value: "any", label: "All statuses" },
]
const LEVEL_LABEL: Record<string, string> = { low: "low", medium: "medium", high: "high", very_high: "very high" }

export default function ApprovalsPage() {
  const [params, setParams] = useSearchParams()
  const selectedId = params.get("request") ? Number(params.get("request")) : null
  const [mine, setMine] = useState<Mine>("waiting")
  const [status, setStatus] = useState<string>("pending")
  const [type, setType] = useState<string | null>(null)
  const [q, setQ] = useState("")

  const summary = useQuery({ queryKey: ["approvals", "summary"], queryFn: () => api.get<ApprovalSummary>("/approvals/summary") })
  const list = useQuery({
    queryKey: ["approvals", "list", mine, status],
    queryFn: () => api.get<Approval[]>("/approvals", { mine, status }),
  })
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (list.data ?? []).filter((a) => (!type || a.target_type === type)
      && (!needle || `${a.target_label} ${a.requested_by?.display_name ?? ""} ${a.approver?.display_name ?? ""}`.toLowerCase().includes(needle)))
  }, [list.data, type, q])
  const types = useMemo(() => [...new Set((list.data ?? []).map((a) => a.target_type))].sort(), [list.data])

  const select = (id: number | null) => {
    const p = new URLSearchParams(params)
    if (id == null) p.delete("request")
    else p.set("request", String(id))
    setParams(p, { replace: true })
  }
  const switchTab = (m: Mine) => {
    setMine(m)
    setStatus(m === "waiting" ? "pending" : m === "requested" ? "open" : "any")
    setType(null)
  }

  // deep link from a notification: open the tab that contains the request
  const deepLinked = useQuery({
    queryKey: ["approvals", "detail", selectedId],
    queryFn: () => api.get<Approval>(`/approvals/${selectedId}`),
    enabled: selectedId != null,
    retry: false,
  })
  const [synced, setSynced] = useState<number | null>(null)
  useEffect(() => {
    const a = deepLinked.data
    if (!a || synced === a.id) return
    setSynced(a.id)
    if (a.can_decide) switchTab("waiting")
    else if (a.can_withdraw || a.status !== "pending") { setMine(a.can_withdraw ? "requested" : "all"); setStatus("any") }
  }, [deepLinked.data, synced])

  const counts = summary.data
  return (
    <div>
      <PageHeader title="Approvals"
        description="Four-eyes approvals of documents, assessment answers and risk acceptances. Each approval records the version that was approved; later changes are flagged." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Approval lists" data-tour="quality.approvals" className="inline-flex rounded-md border bg-card p-0.5">
          {TABS.map((t) => {
            const n = t.key === "waiting" ? counts?.waiting : t.key === "requested" ? counts?.requested_pending : undefined
            return (
              <button key={t.key} role="tab" aria-selected={mine === t.key} title={t.hint} onClick={() => switchTab(t.key)}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-[4px] px-3 text-[13px]",
                  mine === t.key ? "bg-petrol-50 font-medium text-petrol" : "text-ink-2 hover:bg-muted")}>
                {t.label}
                {!!n && <span className={cn("tabular rounded-[4px] px-1 text-[11.5px]", t.key === "waiting" && counts?.waiting_overdue ? "bg-alarm-50 text-alarm" : "bg-muted text-ink-2")}>{n}</span>}
              </button>
            )
          })}
        </div>
        <div className="w-60"><OptionSelect value={status} onChange={(v) => setStatus(v ?? "any")} options={STATUS_OPTIONS} /></div>
        <div className="w-48">
          <OptionSelect value={type} onChange={setType} allowNone noneLabel="All object types" placeholder="All object types"
            options={types.map((t) => ({ value: t, label: targetTypeLabel(t) }))} />
        </div>
        <Input className="w-64" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search object or person" aria-label="Search approvals" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div data-tour="quality.queue">
        <Section className="h-full" bodyClassName="p-0">
          {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} className="m-4" /> : rows.length === 0 ? (
            <Empty icon={<Stamp className="size-6" />} title={mine === "waiting" ? "Nothing to approve" : "No approval requests"}>
              {mine === "waiting"
                ? "When someone asks you to approve a document, an answer or a risk acceptance, it appears here."
                : "Request an approval from a document, an assessment answer or a risk. Change the filters to see decided requests."}
            </Empty>
          ) : (
            <ul>
              {rows.map((a) => <Row key={a.id} a={a} mine={mine} selected={a.id === selectedId} onSelect={() => select(a.id)} />)}
            </ul>
          )}
        </Section>
        </div>

        <div className="xl:sticky xl:top-[72px] xl:self-start">
          {selectedId == null ? (
            <div className="rounded-md border border-dashed bg-card px-4 py-8 text-center text-[13px] text-ink-3">
              Select a request to see the details and decide.
            </div>
          ) : (
            <Detail id={selectedId} onClose={() => select(null)} />
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ a, mine, selected, onSelect }: { a: Approval; mine: Mine; selected: boolean; onSelect: () => void }) {
  const person = mine === "requested" ? `To ${a.approver?.display_name ?? "unknown"}` : `From ${a.requested_by?.display_name ?? "unknown"}`
  return (
    <li className={cn("border-b last:border-0", selected && "bg-petrol-50/60")}>
      <button onClick={onSelect} aria-current={selected || undefined} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 focus-visible:bg-muted/50">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-ink">{a.target_label}</span>
            {a.target_version_label && <span className="tabular shrink-0 text-[12px] text-ink-3">{a.target_version_label}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
            <span>{targetTypeLabel(a.target_type)}</span>
            <span>{person}</span>
            <span title={fmtDateTime(a.created_at)}>{fromNow(a.created_at)}</span>
            {a.meta?.requires_management_body && a.status === "pending" && <ManagementBodyFlag />}
          </div>
        </div>
        {a.entity && <EntityTag code={a.entity.code} name={a.entity.name} />}
        <div className="flex w-36 shrink-0 flex-col items-end gap-1">
          <ApprovalStatePill state={requestState(a)} />
          {a.status === "pending" && a.due_date && (
            <span className={cn("tabular text-[12px]", a.overdue ? "font-medium text-alarm" : "text-ink-3")}>
              {a.overdue ? "Overdue since " : "Due "}{fmtDate(a.due_date)}
            </span>
          )}
        </div>
      </button>
    </li>
  )
}

function Detail({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ["approvals", "detail", id], queryFn: () => api.get<Approval>(`/approvals/${id}`), retry: false })
  const withdraw = useWithdraw()
  if (q.isLoading) return <Section><Loading className="p-0" /></Section>
  if (q.error) {
    return (
      <Section title="Request" actions={<CloseButton onClose={onClose} />}>
        <ErrorState error={q.error instanceof ApiError && q.error.status === 404 ? "This request does not exist or you have no access to it." : q.error} />
      </Section>
    )
  }
  const a = q.data!
  const state = requestState(a)
  const m = a.meta
  return (
    <Section title={targetTypeLabel(a.target_type)} actions={<CloseButton onClose={onClose} />}>
      <div className="space-y-4">
        <div>
          <div className="text-[15px] leading-snug font-semibold text-ink">{a.target_label}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <ApprovalStatePill state={state} />
            {m?.requires_management_body && <ManagementBodyFlag />}
            {a.entity ? <EntityTag code={a.entity.code} name={a.entity.name} /> : <span className="text-[12px] text-ink-3">Group-wide</span>}
          </div>
          {a.target_url && (
            <Button asChild size="sm" variant="outline" className="mt-3">
              <Link to={a.target_url}><ExternalLink /> Open {targetTypeLabel(a.target_type).toLowerCase()}</Link>
            </Button>
          )}
        </div>

        {state === "changed_after_approval" && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-[12.5px] text-amber">
            The object has changed since this approval (or was deleted). The approval covers {a.target_version_label ?? "the earlier state"} only.
          </p>
        )}

        <div className="divide-y rounded-md border px-3">
          <KV label="Version">{a.target_version_label}</KV>
          <KV label="Requested by">{a.requested_by?.display_name} <span className="text-ink-3">on {fmtDateTime(a.created_at)}</span></KV>
          <KV label="Approver">{a.approver?.display_name}</KV>
          <KV label="Due">{a.due_date ? <span className={a.overdue ? "font-medium text-alarm" : undefined}>{fmtDate(a.due_date)}{a.overdue ? ", overdue" : ""}</span> : null}</KV>
          {a.decided_at && <KV label={a.status === "withdrawn" ? "Withdrawn" : "Decided"}>{fmtDateTime(a.decided_at)}</KV>}
        </div>

        {m && a.target_type === "risk_acceptance" && (
          <div className="space-y-1.5 rounded-md border px-3 py-2.5 text-[12.5px]">
            <div className="text-ink-2">
              Residual risk <span className="font-medium text-ink">{LEVEL_LABEL[m.residual_level ?? ""] ?? "not rated"}</span>, risk appetite up to <span className="font-medium text-ink">{LEVEL_LABEL[m.appetite_level ?? ""] ?? "–"}</span>.
            </div>
            {m.acceptance_category && <div className="text-ink-2">Justification category: <span className="text-ink">{m.acceptance_category}</span></div>}
            {m.requires_management_body && (
              <p className="text-alarm">Above the risk appetite: the management body of the entity has to take this decision (BSI guidance on § 30 BSIG, Cbw Art. 24).</p>
            )}
            {m.transfer_only && <p className="text-amber">Transfer is the only treatment. A blanket transfer of risk is not permitted under the BSIG.</p>}
          </div>
        )}

        {a.request_note && (
          <div>
            <h3 className="mb-1 text-[12.5px] font-medium text-ink-3">Request note</h3>
            <Markdown className="prose-md text-[13px]">{a.request_note}</Markdown>
          </div>
        )}
        {a.decision_note && (
          <div>
            <h3 className="mb-1 text-[12.5px] font-medium text-ink-3">Decision note</h3>
            <Markdown className="prose-md text-[13px]">{a.decision_note}</Markdown>
          </div>
        )}

        {a.can_decide && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-[12.5px] text-ink-3">Check the object before you decide. A note is required to reject or request changes.</p>
            <DecisionButtons approval={a} />
          </div>
        )}
        {a.can_withdraw && (
          <div className="border-t pt-3">
            <Button size="sm" variant="outline" disabled={withdraw.isPending} onClick={() => withdraw.mutate(a.id)}>Withdraw request</Button>
          </div>
        )}
        {!a.can_decide && a.status === "pending" && !a.can_withdraw && (
          <p className="border-t pt-3 text-[12.5px] text-ink-3">Waiting for {a.approver?.display_name ?? "the approver"}.</p>
        )}
        {a.status === "approved" && !a.stale && <Pill tone="sage">Approval is current</Pill>}
      </div>
    </Section>
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return <Button size="icon-xs" variant="ghost" aria-label="Close details" onClick={onClose}><X /></Button>
}
