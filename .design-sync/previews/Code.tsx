import { Code, EntityTag, StatusPill } from "@nis2-compass/ui"

export function RequirementNumbers() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
      <Code>1.1.1</Code>
      <Code>5.2.3</Code>
      <Code>14.1.2</Code>
      <Code>AP-005</Code>
      <Code>INC-004</Code>
    </div>
  )
}

export function LegalReferences() {
  return (
    <div className="space-y-1.5 text-[13px] text-ink-2">
      <div><Code>§ 30 Abs. 2 Nr. 1 BSIG</Code> — obligation to register with the BSI</div>
      <div><Code>Art. 21(2)(d) NIS2</Code> — supply chain security</div>
      <div><Code>Art. 23(4)(a) NIS2</Code> — early warning within 24 hours</div>
    </div>
  )
}

export function InARow() {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <Code>AP-005</Code>
      <EntityTag code="ATL" name="Atlas Fertigung GmbH" />
      <span className="text-ink-2">Document the access control procedure</span>
      <StatusPill value="In Progress" />
    </div>
  )
}
