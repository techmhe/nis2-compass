import { PageHeader, Section } from "@/components/common/basics"
import { GettingStarted } from "@/components/help/getting-started"

const ROWS: [string, string][] = [
  ["Scope", "Decide this first. Anything other than \"In Scope\" removes the requirement from coverage, scoring and the work-package logic. Use \"Central at HQ\" where HQ operates the control for a subsidiary, and record the reason in Evidence / Source."],
  ["Implemented", "Actual operational practice, regardless of whether it is documented."],
  ["Documented", "Whether the practice is recorded in a policy, procedure, checklist, ticket workflow or other usable form."],
  ["Effectiveness", "Based on tests, incidents, reports, samples, interviews or observed practice."],
  ["Evidence / Source", "Document or link, ticket, system output, report, interview, observed practice, test result, or the reason for a scope exclusion. Link uploaded documents as evidence directly."],
  ["Gap description", "The specific operational, documentation or effectiveness gap."],
  ["Recommended action", "The smallest practical action that closes or materially reduces the gap."],
]

export default function HelpPage() {
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="Help & scoring model" description="How assessments are scored and how findings flow into the action plan and the project." />
      <GettingStarted />
      <Section title="Scoring">
        <p className="text-[13.5px] text-ink-2">
          The score of a requirement is the average of the answers given in Implemented, Documented and Effectiveness.
          Yes and Effective count as 100%, Partial as 50%, Not Tested as 25%, No and Ineffective as 0%. N/A answers are
          excluded. Requirements that are not in scope have no score.
        </p>
        <table className="mt-3 w-full max-w-md text-[13px]">
          <tbody>
            {[["Yes / Effective", "100%"], ["Partial", "50%"], ["Not Tested", "25%"], ["No / Ineffective", "0%"], ["N/A", "excluded"]].map(([a, s]) => (
              <tr key={a} className="border-t"><td className="py-1.5">{a}</td><td className="tabular py-1.5 text-right">{s}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[13.5px] text-ink-2">
          A work package is required where Implemented or Documented is No or Partial, or Effectiveness is Partial, Not
          Tested or Ineffective. The finding ID is the entity prefix plus the requirement number (e.g. ATL-3.2.1).
        </p>
      </Section>
      <Section title="Chapter targets">
        <p className="text-[13.5px] text-ink-2">
          75% is the score of a requirement that is implemented and documented but whose effectiveness has not yet been
          tested: the lowest defensible target for the first round. Chapters 14–16 (incident reporting, registration,
          management responsibility) are binary obligations with direct penalties, so their target is 100% and the
          governing indicator is zero open findings. Targets can be raised for the second round (capped at 95%); every
          change is recorded with date and reason.
        </p>
      </Section>
      <Section title="Assessment fields">
        <dl className="divide-y">
          {ROWS.map(([k, v]) => (
            <div key={k} className="grid gap-2 py-2 sm:grid-cols-[180px_1fr]">
              <dt className="text-[13px] font-medium">{k}</dt>
              <dd className="text-[13px] text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="Keyboard shortcuts">
        <dl className="grid gap-y-1.5 text-[13px] sm:grid-cols-[160px_1fr]">
          <dt className="font-mono">⌘K / Ctrl K</dt><dd>Search everything or ask the assistant</dd>
          <dt className="font-mono">J / K</dt><dd>Next / previous requirement in the assessment workspace</dd>
          <dt className="font-mono">1 2 3 4</dt><dd>Set Implemented to Yes / Partial / No / N/A</dd>
          <dt className="font-mono">⌘Enter</dt><dd>Send a comment or chat message</dd>
        </dl>
      </Section>
      <Section title="Requirement source">
        <p className="text-[13.5px] text-ink-2">
          The 161 requirements in chapters 1 to 13 are taken verbatim from the Annex to Commission Implementing Regulation
          (EU) 2024/2690. That regulation is binding only on the digital service providers listed in its Article 1. It is
          used here as the concrete Commission benchmark for Article 21(2) NIS2 and, by extension, § 30 BSIG and Art. 21
          Cyberbeveiligingswet. Chapters 14 to 17 cover national obligations: incident reporting (§ 32 BSIG), registration
          (§ 33 BSIG), management responsibility (§ 38 BSIG) and OT / major-accident aspects.
        </p>
      </Section>
      <Section title="Disclaimer">
        <div className="space-y-2 text-[13.5px] text-ink-2">
          <p>
            This software is provided as is under the MIT License, without warranty of any kind, and you use it at your
            own risk. It was developed with the help of AI coding assistants and reviewed and tested before each release,
            but it can still contain errors.
          </p>
          <p>
            It is not legal advice. Requirements, legal references, deadlines and regulation texts were compiled with care
            but can be incomplete or out of date; the official texts are authoritative. Whether your organisation is in
            scope and what it has to do is for you, your legal counsel and the competent authority to decide.
          </p>
          <p>
            Answers and drafts from the AI assistant can be wrong. Check them against the cited sources.
          </p>
        </div>
      </Section>
    </div>
  )
}
