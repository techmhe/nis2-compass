import {
  Button, EntityTag, Field, KeyValue, Pill, Section, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
  SheetTrigger, StatusPill, Textarea,
} from "@nis2-compass/ui"

export function ActionPlanItem() {
  return (
    <Sheet defaultOpen>
      <SheetTrigger asChild><Button variant="outline">Open AP-005</Button></SheetTrigger>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[560px]">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>AP-005 Document the procedure and have it approved by the ISO</SheetTitle>
          <SheetDescription>Action plan item, requirement 1.1.1</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill value="In Progress" />
            <Pill tone="amber">Due 26 Sep 2026</Pill>
            <EntityTag code="ATL" />
          </div>
          <Section title="Details" bodyClassName="space-y-2 p-4">
            <KeyValue label="Owner">Isabel Schmidt</KeyValue>
            <KeyValue label="Requirement">1.1.1 Information security policy</KeyValue>
            <KeyValue label="Priority"><Pill tone="alarm">High</Pill></KeyValue>
          </Section>
          <Field label="Progress note">
            <Textarea rows={3} defaultValue="Draft procedure circulated for ISO review; awaiting sign-off before 26 Sep." />
          </Field>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function LeftSide() {
  return (
    <Sheet defaultOpen>
      <SheetTrigger asChild><Button variant="outline">Filters</Button></SheetTrigger>
      <SheetContent side="left" className="w-full gap-0 p-0 sm:max-w-[360px]">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>Filter action plan</SheetTitle>
          <SheetDescription>Narrow the list by entity, status and priority.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-6 py-4 text-[13px] text-ink-2">
          <div className="flex items-center justify-between"><span>Entity</span><EntityTag code="ATN" /></div>
          <div className="flex items-center justify-between"><span>Status</span><StatusPill value="Open" /></div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
