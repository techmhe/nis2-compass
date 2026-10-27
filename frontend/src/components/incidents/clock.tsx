import { AlertTriangle, Check, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Confirm } from "@/components/common/collab"
import { toDate } from "@/lib/format"
import type { Incident } from "@/lib/types"
import { cn } from "@/lib/utils"
import { duration, fmtDue, type IncidentIn, useNow } from "./shared"

const STEP_FIELD: Record<string, keyof IncidentIn> = {
  early_warning: "early_warning_at",
  notification: "notification_at",
  final_report: "final_report_at",
}

const STEP_HINT: Record<string, string> = {
  early_warning: "Whether the incident is suspected to be caused by unlawful or malicious acts and could have a cross-border impact.",
  notification: "Update of the early warning with an initial assessment: severity, impact and, where available, indicators of compromise.",
  final_report: "Detailed description, type of threat or root cause, applied and ongoing mitigation, cross-border impact.",
}

/** NIS-2 Art. 23(4) reporting clock: early warning (24 h), notification (72 h), final report (1 month). */
export function ReportingClock({ incident, canEdit, blocked, pending, onPatch }: {
  incident: Incident
  canEdit: boolean
  /** Unsaved form changes: steps cannot be marked until they are saved or discarded. */
  blocked: boolean
  pending: boolean
  onPatch: (fields: Partial<IncidentIn>, message: string) => void
}) {
  const now = useNow(30_000)
  const i = incident

  if (i.is_significant !== true || !i.aware_at) {
    return (
      <div className="flex gap-3 rounded-md border border-dashed bg-surface px-4 py-3 text-[13px]">
        <Clock className="mt-0.5 size-4 shrink-0 text-ink-3" />
        <div className="flex-1 space-y-2">
          {i.is_significant === false ? (
            <p className="text-ink-2">
              Classified as not significant, so there is no reporting duty under Art. 23 NIS-2. Voluntary notification to the CSIRT (Art. 30) is still possible,
              for example for near misses or cyber threats.
            </p>
          ) : i.is_significant == null ? (
            <p className="text-ink-2">
              Significance has not been assessed. If the incident is significant, the early warning is due <strong className="font-medium">24 hours</strong> after
              becoming aware of it, so decide quickly.
            </p>
          ) : (
            <p className="text-ink-2">The incident is significant, but the time the entity became aware of it is missing. Enter it below to start the reporting clock.</p>
          )}
          {canEdit && i.is_significant == null && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={pending || blocked} onClick={() => onPatch({ is_significant: true, aware_at: i.aware_at ?? i.detected_at ?? new Date().toISOString() }, "Classified as significant")}>
                Classify as significant
              </Button>
              <Button size="sm" variant="outline" disabled={pending || blocked} onClick={() => onPatch({ is_significant: false }, "Classified as not significant")}>
                Not significant
              </Button>
            </div>
          )}
          {canEdit && i.is_significant === true && !i.aware_at && i.detected_at && (
            <Button size="sm" variant="outline" disabled={pending || blocked} onClick={() => onPatch({ aware_at: i.detected_at }, "Awareness time set")}>
              Use detection time ({fmtDue(i.detected_at)})
            </Button>
          )}
          {blocked && canEdit && <p className="text-[12px] text-amber">Save or discard your changes below first.</p>}
        </div>
      </div>
    )
  }

  const awareAt = toDate(i.aware_at)!.getTime()
  const steps = i.reporting
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-ink-3">
        <span>Clock started when the entity became aware of the incident:</span>
        <span className="tabular font-medium text-ink">{fmtDue(i.aware_at)}</span>
        <span>({duration(now - awareAt)} ago)</span>
      </div>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map((s, idx) => {
          const due = toDate(s.due)!.getTime()
          const done = toDate(s.done_at)?.getTime() ?? null
          const overdue = !done && due < now
          const soon = !done && !overdue && due - now < 12 * 3_600_000
          const field = STEP_FIELD[s.key]
          return (
            <li key={s.key}
              className={cn("relative rounded-md border px-3 py-2.5",
                done ? "border-petrol/40 bg-petrol-50/40" : overdue ? "border-alarm/50 bg-alarm-50/50" : soon ? "border-amber/50 bg-amber-50/40" : "bg-card")}>
              <div className="flex items-center gap-2">
                <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
                  done ? "bg-petrol text-white" : overdue ? "bg-alarm text-white" : "border border-ink-3/60 text-ink-2")}>
                  {done ? <Check className="size-3.5" /> : overdue ? <AlertTriangle className="size-3.5" /> : idx + 1}
                </span>
                <span className="text-[13.5px] font-semibold text-ink">{s.label}</span>
              </div>
              <div className="mt-2 space-y-0.5 text-[12.5px]">
                <div className="text-ink-3">Due <span className="tabular text-ink-2">{fmtDue(s.due)}</span></div>
                {done ? (
                  <div className="text-petrol">
                    Sent <span className="tabular">{fmtDue(s.done_at)}</span>
                    <span className="text-ink-3">{done <= due ? `, ${duration(due - done)} before the deadline` : `, ${duration(done - due)} late`}</span>
                  </div>
                ) : overdue ? (
                  <div className="font-medium text-alarm" role="status">Overdue by {duration(now - due)}</div>
                ) : (
                  <div className={cn("tabular", soon ? "font-medium text-amber" : "text-ink-2")}>{duration(due - now)} left</div>
                )}
              </div>
              <p className="mt-1.5 text-[12px] leading-snug text-ink-3">{STEP_HINT[s.key]}</p>
              {canEdit && field && (
                <div className="mt-2">
                  {done ? (
                    <Confirm title={`Undo “${s.label}”?`} description="The step is marked as not sent again. The time already recorded is removed from the incident."
                      confirmLabel="Mark as not sent" destructive={false} onConfirm={() => onPatch({ [field]: null }, `${s.label} marked as not sent`)}
                      trigger={<Button size="xs" variant="ghost" disabled={pending || blocked}>Undo</Button>} />
                  ) : (
                    <Button size="sm" variant={overdue || soon ? "default" : "outline"} disabled={pending || blocked}
                      onClick={() => onPatch({ [field]: new Date().toISOString() }, `${s.label} marked as sent`)}>
                      Mark as sent now
                    </Button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        <span>Intermediate report (only on request of the CSIRT or authority, Art. 23(4)(c)):</span>
        {i.intermediate_report_at ? (
          <span className="text-petrol">sent <span className="tabular">{fmtDue(i.intermediate_report_at)}</span></span>
        ) : <span>not sent</span>}
        {canEdit && !i.intermediate_report_at && (
          <Button size="xs" variant="outline" disabled={pending || blocked}
            onClick={() => onPatch({ intermediate_report_at: new Date().toISOString() }, "Intermediate report marked as sent")}>
            Mark as sent now
          </Button>
        )}
      </div>
      {blocked && canEdit && <p className="mt-2 text-[12px] text-amber">You have unsaved changes below. Save or discard them before marking a report as sent.</p>}
    </div>
  )
}
