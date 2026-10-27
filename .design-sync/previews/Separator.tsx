import { Button, Separator } from "@nis2-compass/ui"

export function Horizontal() {
  return (
    <div className="w-[320px]">
      <div className="text-[13px] font-medium text-ink">Action plan</div>
      <Separator className="my-3" />
      <div className="text-[13px] text-ink-2">Consolidated remediation measures for all findings of the GAP assessment.</div>
    </div>
  )
}

export function ToolbarVertical() {
  return (
    <div className="flex h-8 items-center gap-2 rounded-md border bg-surface px-2">
      <Button variant="ghost" size="sm">Export workbook</Button>
      <Separator orientation="vertical" />
      <Button variant="ghost" size="sm">Bundle into work package</Button>
      <Separator orientation="vertical" />
      <Button variant="ghost" size="sm">Delete</Button>
    </div>
  )
}
