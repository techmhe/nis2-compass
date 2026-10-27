import { Code, ScrollArea, Separator } from "@nis2-compass/ui"

const REQUIREMENTS = [
  { req: "1.1.1", title: "Document the information security policy and have it approved by the ISO" },
  { req: "1.1.2", title: "Extend the control to all entities via Central IT" },
  { req: "2.1.1", title: "Plan and perform an effectiveness test; record results" },
  { req: "5.1.4", title: "Maintain a supplier register with criticality classification" },
  { req: "8.2.3", title: "Enforce multi-factor authentication for remote administrative access" },
  { req: "12.1.1", title: "Log and monitor access to systems processing personal data" },
  { req: "14.1.2", title: "Deliver security awareness training to all staff annually" },
  { req: "15.1.1", title: "Confirm entity classification and competent authority, complete registration" },
]

export function RequirementList() {
  return (
    <ScrollArea className="h-[220px] w-[360px] rounded-md border">
      <div className="p-3">
        {REQUIREMENTS.map((r, i) => (
          <div key={r.req}>
            {i > 0 && <Separator className="my-2" />}
            <div className="flex items-start gap-2 text-[13px]">
              <Code>{r.req}</Code>
              <span className="text-ink-2">{r.title}</span>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

export function NarrowPanel() {
  return (
    <ScrollArea className="h-[160px] w-[220px] rounded-md border bg-surface">
      <div className="divide-y">
        {REQUIREMENTS.slice(0, 5).map((r) => (
          <div key={r.req} className="px-3 py-2 text-[12.5px] text-ink-2">{r.req} · {r.title.slice(0, 28)}…</div>
        ))}
      </div>
    </ScrollArea>
  )
}
