import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { Code, ErrorState, Loading, Pill, Section } from "@/components/common/basics"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { RegStatusPill } from "./registrations"
import { DueBadge, govKeys, TrainingPill } from "./shared"
import type { BoardMember, Obligation, Registration } from "./types"

/** Governance summary for the entity page: registration, management body and open obligations. */
export function EntityGovernanceSection({ entityId }: { entityId: number }) {
  const { can } = useAuth()
  const allowed = can("governance.read", entityId)
  const regs = useQuery({ queryKey: govKeys.registrations, queryFn: () => api.get<Registration[]>("/governance/registrations"), enabled: allowed })
  const members = useQuery({ queryKey: [...govKeys.members, entityId], queryFn: () => api.get<BoardMember[]>("/governance/board-members", { entity_id: entityId, include_former: false }), enabled: allowed })
  const obs = useQuery({ queryKey: [...govKeys.obligations, entityId, "open"], queryFn: () => api.get<Obligation[]>("/governance/obligations", { entity_id: entityId, status: "open" }), enabled: allowed })
  if (!allowed) return null
  const error = regs.error ?? members.error ?? obs.error
  const mine = (regs.data ?? []).filter((r) => r.entity.id === entityId)
  const overdue = (obs.data ?? []).filter((o) => o.state === "overdue")
  const next = (obs.data ?? []).filter((o) => o.state !== "overdue").slice(0, 3)
  return (
    <Section title="Governance" className="mt-5"
      actions={<Link to="/governance" className="text-[12.5px] text-petrol hover:underline">Open governance</Link>}>
      {regs.isLoading || members.isLoading || obs.isLoading ? <Loading className="p-2" /> : error ? <ErrorState error={error} /> : (
        <div className="grid gap-6 md:grid-cols-3">
          <div>
            <h3 className="mb-2 text-[12.5px] font-medium text-ink-2">Registration</h3>
            {mine.length === 0 ? (
              <p className="text-[13px] text-ink-3">No registration record. <Link to="/governance/registrations" className="text-petrol hover:underline">Create one</Link> to keep the portal data and the change deadlines.</p>
            ) : mine.map((r) => (
              <Link key={r.id} to={`/governance/registrations?registration=${r.id}`} className="-m-1 mb-1 block rounded-md p-1 text-[13px] hover:bg-muted/60">
                <div className="flex flex-wrap items-center gap-2"><Pill tone="outline">{r.jurisdiction}</Pill><RegStatusPill status={r.status} /></div>
                <div className="mt-1 text-[12.5px] text-ink-3">{r.registration_number ? <Code>{r.registration_number}</Code> : r.portal}</div>
                {r.pending_changes > 0 && <div className="mt-1"><Pill tone={r.overdue_changes ? "alarm" : "amber"}>{r.pending_changes} change{r.pending_changes > 1 ? "s" : ""} to report by {fmtDate(r.next_change_due)}</Pill></div>}
              </Link>
            ))}
          </div>
          <div>
            <h3 className="mb-2 text-[12.5px] font-medium text-ink-2">Management body</h3>
            {!members.data?.length ? (
              <p className="text-[13px] text-ink-3">No members recorded. <Link to="/governance/management" className="text-petrol hover:underline">Add them</Link> to track training duties.</p>
            ) : (
              <ul className="space-y-1.5">
                {members.data.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <Link to={`/governance/management?member=${m.id}`} className="min-w-0 truncate hover:text-petrol">{m.name}<span className="text-ink-3">{m.function ? `, ${m.function}` : ""}</span></Link>
                    <TrainingPill status={m.training.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-[12.5px] font-medium text-ink-2">Obligations</h3>
            {!obs.data?.length ? <p className="text-[13px] text-ink-3">No open obligations.</p> : (
              <ul className="space-y-1.5">
                {[...overdue, ...next].map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <Link to={`/governance/obligations?obligation=${o.id}`} className="min-w-0 truncate hover:text-petrol" title={o.title}>{o.title}</Link>
                    {o.state === "overdue" ? <DueBadge state="overdue" /> : <span className="tabular shrink-0 text-[12px] text-ink-3">{fmtDate(o.due_date)}</span>}
                  </li>
                ))}
                {obs.data.length > overdue.length + next.length && (
                  <li className="text-[12.5px] text-ink-3">{obs.data.length - overdue.length - next.length} more in the <Link to="/governance/obligations" className="text-petrol hover:underline">obligation calendar</Link>.</li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </Section>
  )
}
