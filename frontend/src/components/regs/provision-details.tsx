import { useState } from "react"
import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { Bot, ChevronRight, FileText, Link2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Code, ErrorState, Loading, Pill, StatusPill } from "@/components/common/basics"
import { useAssistant } from "@/components/assistant/provider"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { pct, scoreColor } from "@/lib/format"
import type { ProvisionDetail } from "./model"

const RELATION_LABEL: Record<string, string> = {
  legal_basis: "Legal basis",
  benchmark: "Benchmark text",
  national_equivalent: "National equivalent",
  iso_mapping: "ISO mapping",
  related: "Related",
}

const PREVIEW = 8

/** Linked requirements (with per-entity status), ancestors and documents of one provision. */
export function ProvisionDetails({ provisionId, onSelect, onClose }: {
  provisionId: number
  onSelect: (id: number) => void
  onClose: () => void
}) {
  const { canAny } = useAuth()
  const { openAssistant } = useAssistant()
  const [showAll, setShowAll] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ["provision", provisionId],
    queryFn: () => api.get<ProvisionDetail>(`/regulations/provisions/${provisionId}`),
  })
  const copyLink = () => {
    const url = `${window.location.origin}/regulations/${data?.provision.regulation.id}?p=${provisionId}`
    navigator.clipboard.writeText(url).then(() => toast.success("Link copied"), () => toast.error("Could not copy the link"))
  }

  return (
    <div className="my-2 rounded-md border border-petrol/30 bg-card text-[13px] not-italic" style={{ whiteSpace: "normal" }}
      onClick={(e) => e.stopPropagation()}>
      {isLoading ? <Loading className="p-3" /> : error ? <ErrorState error={error} className="m-3" /> : data && (
        <>
          <div className="flex items-start gap-2 border-b px-3 py-2">
            <nav aria-label="Position in the regulation" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5 text-[12px] text-ink-3">
              {data.ancestors.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1">
                  <button type="button" className="hover:text-petrol" onClick={() => onSelect(a.id)} title={a.heading ?? undefined}>{a.ref}</button>
                  <ChevronRight className="size-3" />
                </span>
              ))}
              <span className="font-medium text-ink">{data.provision.ref}</span>
            </nav>
            <Button size="xs" variant="ghost" onClick={copyLink}><Link2 /> Copy link</Button>
            {canAny("ai.use") && (
              <Button size="xs" variant="ghost" onClick={() => openAssistant({
                question: `Explain ${data.provision.ref} of the ${data.provision.regulation.short_title} and what it requires from us.`,
                context: { type: "provision", id: provisionId, label: `${data.provision.regulation.short_title} ${data.provision.ref}` },
                expanded: true,
              })}>
                <Bot /> Ask the assistant
              </Button>
            )}
            <Button size="icon-xs" variant="ghost" aria-label="Close details" onClick={onClose}><X /></Button>
          </div>

          <div className="space-y-3 px-3 py-2.5">
            <div>
              <h4 className="mb-1.5 text-[12.5px] font-medium text-ink-3">
                Linked requirements <span className="tabular">{data.requirements.length}</span>
              </h4>
              {data.requirements.length === 0 ? (
                <p className="text-[12.5px] text-ink-3">No requirement of the catalogue refers to this provision or its sub-provisions.</p>
              ) : (
                <>
                <ul className="divide-y rounded-md border">
                  {(showAll ? data.requirements : data.requirements.slice(0, PREVIEW)).map((r) => (
                    <li key={r.link_id} className="grid gap-1 px-2.5 py-1.5">
                      <Link to={`/catalog/${r.requirement.id}`} className="flex min-w-0 items-baseline gap-2 hover:text-petrol">
                        <Code className="shrink-0">{r.requirement.number}</Code>
                        <span className="min-w-0">{r.requirement.section.replace(/^[\d.]+\s*/, "")}</span>
                        {r.requirement.is_core && <Pill tone="brass" title="Core requirement">Core</Pill>}
                      </Link>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[11.5px] text-ink-3">
                        {RELATION_LABEL[r.relation] ?? r.relation}{!r.direct ? ", via sub-provision" : ""}
                      </span>
                      {r.status.length > 0 && (
                        <span className="flex flex-wrap gap-1">
                          {r.status.map((s) => (
                            <Tooltip key={s.entity_code}>
                              <TooltipTrigger asChild>
                                <Link to={`/assessments/${s.assessment_id}?req=${r.requirement.id}`}
                                  className="tabular inline-flex h-5 items-center gap-1 rounded-[4px] border bg-surface px-1.5 font-mono text-[11px] text-ink-2 hover:border-petrol">
                                  {s.entity_code}
                                  <span className="size-2 rounded-[2px]" style={{ background: s.scope === "In Scope" ? scoreColor(s.score) : "var(--line)" }} />
                                  <span className="font-sans">{s.scope !== "In Scope" ? (s.scope === "Not Applicable" ? "n/a" : "HQ") : pct(s.score)}</span>
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent>
                                {s.entity_code}: {s.scope}{s.scope === "In Scope" ? `, implemented ${s.implemented ?? "not assessed"}, score ${pct(s.score)}` : ""}. Open the answer in the assessment.
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </span>
                      )}
                      </div>
                    </li>
                  ))}
                </ul>
                {data.requirements.length > PREVIEW && (
                  <button type="button" className="mt-1.5 text-[12.5px] text-petrol hover:underline" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Show fewer" : `Show all ${data.requirements.length} linked requirements`}
                  </button>
                )}
                </>
              )}
            </div>
            {data.documents.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-[12.5px] font-medium text-ink-3">Linked documents <span className="tabular">{data.documents.length}</span></h4>
                <ul className="space-y-1">
                  {data.documents.map((d) => (
                    <li key={d.link_id} className="flex items-center gap-2">
                      <FileText className="size-3.5 text-ink-3" />
                      <Link to={`/documents/${d.document_id}`} className="min-w-0 flex-1 truncate hover:text-petrol">{d.title}</Link>
                      <StatusPill value={d.status} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
