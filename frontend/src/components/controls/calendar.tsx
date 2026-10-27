import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Code, EntityTag, Empty, ErrorState, Loading, Section, Stat } from "@/components/common/basics"
import { EntitySelect } from "@/components/common/fields"
import { api } from "@/lib/api"
import { fmtDate, isoDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { OccurrenceSheet } from "./occurrence-sheet"
import { cellTone, daysFromToday, daysLabel, LegendSwatch, MONTHS, OccurrencePill, RESULT_LABEL, STATUS_LABEL } from "./shared"
import type { CalendarData, Occurrence } from "./types"

interface Summary {
  overdue: number
  due_next_30_days: number
  done_last_90_days: number
  not_effective_last_90_days: number
  exceptions_pending: number
  exceptions_expiring_30_days: number
  exceptions_expired: number
}

function monthLabel(key: string) {
  const [y, m] = key.split("-")
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`
}

function shiftMonth(key: string, n: number) {
  const [y, m] = key.split("-").map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

export function useOccurrenceParam() {
  const [params, setParams] = useSearchParams()
  const id = params.get("occurrence") ? Number(params.get("occurrence")) : null
  const open = (oid: number) => setParams((p) => { p.set("occurrence", String(oid)); return p })
  const close = () => setParams((p) => { p.delete("occurrence"); return p })
  return { id, open, close }
}

export function CalendarTab() {
  const [entity, setEntity] = useState<number | null>(null)
  const [start, setStart] = useState<string | null>(null)
  const occ = useOccurrenceParam()
  const cal = useQuery({
    queryKey: ["controls", "calendar", entity, start],
    queryFn: () => api.get<CalendarData>("/controls/calendar", { entity_id: entity, start, months: 12 }),
  })
  const summary = useQuery({ queryKey: ["controls", "summary"], queryFn: () => api.get<Summary>("/controls/summary") })
  const horizon = isoDate(new Date(Date.now() + 30 * 86_400_000))
  const open = useQuery({
    queryKey: ["controls", "occurrences", "open", entity, horizon],
    queryFn: () => api.get<Occurrence[]>("/controls/occurrences", { status: "open", entity_id: entity, date_to: horizon }),
  })
  const current = cal.data?.today.slice(0, 7)
  const first = start ?? cal.data?.months[0] ?? null

  return (
    <div className="space-y-5">
      {summary.data && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border bg-card px-5 py-4 md:grid-cols-4">
          <Stat label="Overdue controls" value={summary.data.overdue} tone={summary.data.overdue ? "alarm" : undefined} hint="Planned and past the due date" />
          <Stat label="Due in the next 30 days" value={summary.data.due_next_30_days} tone={summary.data.due_next_30_days ? "amber" : undefined} />
          <Stat label="Not effective (last 90 days)" value={summary.data.not_effective_last_90_days}
            tone={summary.data.not_effective_last_90_days ? "alarm" : undefined} hint={`${summary.data.done_last_90_days} performed`} />
          <Stat label="Exceptions awaiting approval" value={summary.data.exceptions_pending}
            hint={`${summary.data.exceptions_expiring_30_days} expiring within 30 days, ${summary.data.exceptions_expired} expired`}
            tone={summary.data.exceptions_expired ? "alarm" : undefined} />
        </div>
      )}

      <Section
        title="Control plan"
        actions={
          <div className="flex items-center gap-2">
            <div className="w-48"><EntitySelect value={entity} onChange={setEntity} groupLabel="All entities" /></div>
            <Button variant="outline" size="icon-sm" aria-label="Show earlier months" disabled={!first}
              onClick={() => first && setStart(shiftMonth(first, -3))}><ChevronLeft /></Button>
            <Button variant="outline" size="sm" onClick={() => setStart(null)} disabled={start == null}>Today</Button>
            <Button variant="outline" size="icon-sm" aria-label="Show later months" disabled={!first}
              onClick={() => first && setStart(shiftMonth(first, 3))}><ChevronRight /></Button>
          </div>
        }
        bodyClassName="p-0"
      >
        {cal.isLoading ? <Loading /> : cal.error ? <ErrorState error={cal.error} className="m-4" /> : !cal.data || cal.data.rows.length === 0 ? (
          <Empty title="No control activities yet" icon={<CalendarCheck className="size-6" />}>
            Create recurring activities on the Activities tab; their occurrences for the next 12 months appear here.
          </Empty>
        ) : (
          <>
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[980px] border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr className="text-left text-[12px] text-ink-3">
                    <th className="sticky left-0 z-10 min-w-[260px] border-b bg-card py-2 pr-3 pl-4 font-medium">Activity</th>
                    {cal.data.months.map((m) => (
                      <th key={m} className={cn("border-b px-1 py-2 text-center font-medium whitespace-nowrap", m === current && "bg-petrol-50 text-petrol")}>
                        {monthLabel(m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cal.data.rows.map((r) => (
                    <tr key={r.activity.id}>
                      <td className="sticky left-0 z-10 border-b bg-card py-1.5 pr-3 pl-4">
                        <Link to={`/controls/activities?activity=${r.activity.id}`} className="flex items-baseline gap-2 hover:text-petrol">
                          <Code className="shrink-0 text-ink-3">{r.activity.code}</Code>
                          <span className={cn("line-clamp-1", !r.activity.active && "text-ink-3")} title={r.activity.title}>{r.activity.title}</span>
                        </Link>
                      </td>
                      {cal.data!.months.map((m) => {
                        const cells = r.cells[m] ?? []
                        return (
                          <td key={m} className={cn("border-b px-1 py-1 align-middle", m === current && "bg-petrol-50/40")}>
                            <div className="flex flex-wrap justify-center gap-0.5">
                              {cells.map((c) => (
                                <Tooltip key={c.id}>
                                  <TooltipTrigger asChild>
                                    <button type="button" onClick={() => occ.open(c.id)}
                                      aria-label={`${r.activity.code} ${c.entity_code} ${c.period_label}: ${c.status === "done" && c.result ? RESULT_LABEL[c.result] : STATUS_LABEL[c.status]}`}
                                      className={cn("h-5 min-w-[30px] rounded-[3px] px-1 font-mono text-[10.5px] leading-5 font-medium transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-petrol",
                                        cellTone(c.status, c.result))}>
                                      {c.entity_code}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {r.activity.code} {c.entity_code}, {c.period_label}: {c.status === "done" && c.result ? RESULT_LABEL[c.result] : STATUS_LABEL[c.status]} (due {fmtDate(c.due_date)})
                                  </TooltipContent>
                                </Tooltip>
                              ))}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-4 px-4 py-3 text-[12px] text-ink-3">
              <LegendSwatch className="bg-petrol">Effective</LegendSwatch>
              <LegendSwatch className="bg-amber">Partially effective</LegendSwatch>
              <LegendSwatch className="bg-alarm">Not effective</LegendSwatch>
              <LegendSwatch className="border border-alarm bg-alarm-50">Overdue</LegendSwatch>
              <LegendSwatch className="border bg-surface">Planned</LegendSwatch>
              <LegendSwatch className="border border-dashed border-ink-3/50">Skipped</LegendSwatch>
              <span>Each chip is one entity; select it to record the result.</span>
            </div>
          </>
        )}
      </Section>

      <OpenList data={open.data} loading={open.isLoading} error={open.error} onOpen={occ.open} />
      <OccurrenceSheet id={occ.id} onClose={occ.close} />
    </div>
  )
}

function OpenList({ data, loading, error, onOpen }: { data?: Occurrence[]; loading: boolean; error: unknown; onOpen: (id: number) => void }) {
  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => a.due_date.localeCompare(b.due_date)), [data])
  return (
    <Section title={<span>Overdue and due in the next 30 days <span className="tabular font-normal text-ink-3">{rows.length}</span></span>} bodyClassName="p-0">
      {loading ? <Loading /> : error ? <ErrorState error={error} className="m-4" /> : rows.length === 0 ? (
        <Empty title="Nothing due">No control is overdue or due within the next 30 days.</Empty>
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b text-left text-[12px] text-ink-3">
                <th className="py-2 pr-2 pl-4 font-medium">Due</th>
                <th className="px-2 py-2 font-medium">Activity</th>
                <th className="px-2 py-2 font-medium">Entity</th>
                <th className="px-2 py-2 font-medium">Period</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 pr-4 text-right font-medium"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const d = daysFromToday(o.due_date)
                return (
                  <tr key={o.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="tabular py-2 pr-2 pl-4 whitespace-nowrap">
                      <div className="text-ink">{fmtDate(o.due_date)}</div>
                      <div className={cn("text-[12px]", d < 0 ? "text-alarm" : "text-ink-3")}>{daysLabel(d)}</div>
                    </td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => onOpen(o.id)} className="flex items-baseline gap-2 text-left hover:text-petrol">
                        <Code className="shrink-0">{o.activity.code}</Code><span>{o.activity.title}</span>
                      </button>
                    </td>
                    <td className="px-2 py-2"><EntityTag code={o.entity.code} name={o.entity.name} /></td>
                    <td className="px-2 py-2 text-ink-2">{o.period_label}</td>
                    <td className="px-2 py-2"><OccurrencePill status={o.status} result={o.result} /></td>
                    <td className="px-2 py-2 pr-4 text-right">
                      <Button size="xs" variant={o.can_record ? "outline" : "ghost"} onClick={() => onOpen(o.id)}>
                        {o.can_record ? "Record result" : "View"}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}
