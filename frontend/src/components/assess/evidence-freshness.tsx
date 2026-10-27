import { useQuery } from "@tanstack/react-query"
import { Pill } from "@/components/common/basics"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"

interface FreshnessItem {
  answer_id: number
  status: "fresh" | "ageing" | "stale" | "none"
  last_evidence_at: string | null
  age_days: number | null
  validity_days: number | null
  source_label: string | null
}

const TONE = { fresh: "sage", ageing: "amber", stale: "alarm", none: "outline" } as const
const LABEL = { fresh: "Evidence current", ageing: "Evidence ageing", stale: "Evidence outdated", none: "No dated evidence" }

export function useFreshness(assessmentId: number) {
  const { canAny } = useAuth()
  return useQuery({
    queryKey: ["freshness", assessmentId],
    queryFn: () => api.get<{ items: FreshnessItem[] }>("/controls/freshness", { assessment_id: assessmentId }),
    enabled: canAny("assessments.read"),
    staleTime: 60_000,
    select: (d) => new Map(d.items.map((i) => [i.answer_id, i])),
  })
}

/** Age of the newest evidence (linked documents or effective control results) against its validity period. */
export function EvidenceFreshness({ assessmentId, answerId }: { assessmentId: number; answerId: number }) {
  const q = useFreshness(assessmentId)
  const f = q.data?.get(answerId)
  if (!f) return null
  const detail = f.last_evidence_at
    ? `Newest evidence ${fmtDate(f.last_evidence_at)}${f.source_label ? ` (${f.source_label})` : ""}${f.validity_days ? `, valid for ${f.validity_days} days` : ""}.`
    : "No linked document or control result with a date yet."
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
      <Pill tone={TONE[f.status]}>{LABEL[f.status]}</Pill>
      <span>{detail}</span>
    </div>
  )
}
