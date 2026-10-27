import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nis2-compass/ui"

export function LineVariant() {
  return (
    <Tabs defaultValue="plan" className="w-[400px]">
      <TabsList variant="line" className="mb-3">
        <TabsTrigger value="plan">Action plan <span className="tabular text-ink-3">22</span></TabsTrigger>
        <TabsTrigger value="unplanned">Unplanned findings <span className="tabular text-ink-3">257</span></TabsTrigger>
      </TabsList>
      <TabsContent value="plan">
        <p className="text-[13px] text-ink-2">22 measures are consolidated into the current implementation plan.</p>
      </TabsContent>
      <TabsContent value="unplanned">
        <p className="text-[13px] text-ink-2">257 findings from the GAP assessment are not yet bundled into an action plan item.</p>
      </TabsContent>
    </Tabs>
  )
}

export function DefaultVariant() {
  return (
    <Tabs defaultValue="details" className="w-[360px]">
      <TabsList>
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>
      <TabsContent value="details">
        <p className="text-[13px] text-ink-2">Requirement 1.1.1 · Document the information security policy and have it approved by the ISO.</p>
      </TabsContent>
      <TabsContent value="history">
        <p className="text-[13px] text-ink-2">Status changed to "In Progress" on 26 Aug 2026 by A. Berg.</p>
      </TabsContent>
      <TabsContent value="documents">
        <p className="text-[13px] text-ink-2">Information Security Policy v3.2 (PDF), linked 2 Sep 2026.</p>
      </TabsContent>
    </Tabs>
  )
}
