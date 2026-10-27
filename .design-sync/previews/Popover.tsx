import {
  Button, Checkbox, Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger,
} from "@nis2-compass/ui"
import { ListFilter } from "lucide-react"

export function FilterPanel() {
  return (
    <Popover defaultOpen>
      <PopoverTrigger asChild><Button variant="outline"><ListFilter /> Filter</Button></PopoverTrigger>
      <PopoverContent className="w-72">
        <PopoverHeader>
          <PopoverTitle>Filter risks</PopoverTitle>
          <PopoverDescription>Applies to the risk register view.</PopoverDescription>
        </PopoverHeader>
        <div className="mt-3 space-y-2 text-[13px]">
          <label className="flex items-center gap-2"><Checkbox defaultChecked /> Entity: ATN</label>
          <label className="flex items-center gap-2"><Checkbox defaultChecked /> Severity: High, Critical</label>
          <label className="flex items-center gap-2"><Checkbox /> Include closed risks</label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm">Reset</Button>
          <Button size="sm">Apply</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function QuickInfo() {
  return (
    <Popover defaultOpen>
      <PopoverTrigger asChild><Button variant="link" size="sm">Why is this blocked?</Button></PopoverTrigger>
      <PopoverContent className="w-64 text-[13px] text-ink-2">
        Work package AP-011 is blocked pending confirmation of the effectiveness test scope from the ISO.
      </PopoverContent>
    </Popover>
  )
}
