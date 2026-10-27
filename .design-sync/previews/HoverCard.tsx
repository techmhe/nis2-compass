import { EntityTag, HoverCard, HoverCardContent, HoverCardTrigger, KeyValue, StatusPill } from "@nis2-compass/ui"

export function EntityPreview() {
  return (
    <HoverCard open>
      <HoverCardTrigger asChild>
        <span className="cursor-default underline decoration-dotted underline-offset-4">ATN – Atlas Nederland B.V.</span>
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="flex items-center gap-2">
          <EntityTag code="ATN" />
          <span className="text-[13px] font-medium text-ink">Atlas Nederland B.V.</span>
        </div>
        <div className="mt-2 space-y-1">
          <KeyValue label="Classification">Important entity</KeyValue>
          <KeyValue label="Competent authority">RDI (Netherlands)</KeyValue>
          <KeyValue label="Status"><StatusPill value="In Progress" /></KeyValue>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

export function OwnerPreview() {
  return (
    <HoverCard open>
      <HoverCardTrigger asChild>
        <span className="cursor-default underline decoration-dotted underline-offset-4">Isabel Schmidt</span>
      </HoverCardTrigger>
      <HoverCardContent className="w-56">
        <div className="text-[13px] font-medium text-ink">Isabel Schmidt</div>
        <div className="text-[12px] text-ink-3">ISO, Group Security Office</div>
        <div className="mt-2 text-[12.5px] text-ink-2">7 open action plan items across 3 entities.</div>
      </HoverCardContent>
    </HoverCard>
  )
}
