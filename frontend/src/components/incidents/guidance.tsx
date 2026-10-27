import type { ReactNode } from "react"
import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { Regulation } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Link into the regulations library by regulation code and provision key (resolved by the library page). */
export function LawRef({ code, k, children }: { code: string; k: string; children: ReactNode }) {
  const { canAny } = useAuth()
  const { data } = useQuery({
    queryKey: ["regulations"],
    queryFn: () => api.get<Regulation[]>("/regulations"),
    staleTime: 5 * 60_000,
    enabled: canAny("regulations.read"),
  })
  const reg = data?.find((r) => r.code === code)
  if (!reg) return <span className="font-mono text-[12px]">{children}</span>
  return <Link to={`/regulations/${reg.id}?k=${encodeURIComponent(k)}`} className="font-mono text-[12px] text-petrol hover:underline">{children}</Link>
}

export function SignificanceGuidance({ country }: { country: string | null | undefined }) {
  const de = country === "DE"
  const nl = country === "NL"
  return (
    <div className="space-y-4 text-[13px] leading-relaxed text-ink-2">
      <div>
        <h3 className="mb-1 font-semibold text-ink">When is an incident significant?</h3>
        <p>
          Under <LawRef code="NIS2" k="23.3">Art. 23(3) NIS-2</LawRef> an incident is significant if it
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>has caused or is capable of causing severe operational disruption of the services or financial loss for the entity, or</li>
          <li>has affected or is capable of affecting other natural or legal persons by causing considerable material or non-material damage.</li>
        </ul>
        <p className="mt-1.5 text-[12.5px] text-ink-3">
          For digital providers (cloud, data centre, managed services and similar) the thresholds of <LawRef code="IR2024/2690" k="3">Art. 3 to 14 of Implementing Regulation (EU) 2024/2690</LawRef> apply.
          Record the reasoning in the significance rationale, including a decision not to report.
        </p>
      </div>
      <div className={cn("rounded-md border px-3 py-2", de && "border-petrol/40 bg-petrol-50/40")}>
        <h3 className="mb-1 font-semibold text-ink">Germany: report to the BSI</h3>
        <p>
          <LawRef code="BSIG" k="32">§ 32 BSIG</LawRef> requires important and particularly important entities to report via the joint reporting portal of the
          BSI and the BBK: an early warning (frühe Erstmeldung) within 24 hours, a notification within 72 hours, an interim report on request and a final report
          one month after the notification. If the incident is still ongoing by then, a progress report (Fortschrittsmeldung) is due instead and the final report
          follows once the incident has been fully handled.
        </p>
      </div>
      <div className={cn("rounded-md border px-3 py-2", nl && "border-petrol/40 bg-petrol-50/40")}>
        <h3 className="mb-1 font-semibold text-ink">Netherlands: report to the CSIRT</h3>
        <p>
          Under the Cyberbeveiligingswet (<LawRef code="CBW" k="25">Art. 25 to 29 Cbw</LawRef>) significant incidents are reported to the competent CSIRT
          and the competent authority: vroegtijdige waarschuwing within 24 hours, melding within 72 hours, tussentijds verslag on request and an
          eindverslag within one month. Check the reporting channel of your sector in advance.
        </p>
      </div>
      <p className="text-[12px] text-ink-3">
        Deadlines run from the moment the entity became aware of the significant incident. This guidance is a summary; the linked legal texts are authoritative.
      </p>
    </div>
  )
}
