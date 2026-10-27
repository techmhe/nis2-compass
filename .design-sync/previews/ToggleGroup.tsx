import { ToggleGroup, ToggleGroupItem } from "@nis2-compass/ui"
import { GanttChartSquare, LayoutGrid, List } from "lucide-react"

export function ViewSwitcher() {
  return (
    <ToggleGroup type="single" defaultValue="table" variant="outline">
      <ToggleGroupItem value="table"><List /> Table</ToggleGroupItem>
      <ToggleGroupItem value="board"><LayoutGrid /> Board</ToggleGroupItem>
      <ToggleGroupItem value="gantt"><GanttChartSquare /> Gantt</ToggleGroupItem>
    </ToggleGroup>
  )
}

export function Multiple() {
  return (
    <ToggleGroup type="multiple" defaultValue={["high", "critical"]}>
      <ToggleGroupItem value="low">Low</ToggleGroupItem>
      <ToggleGroupItem value="medium">Medium</ToggleGroupItem>
      <ToggleGroupItem value="high">High</ToggleGroupItem>
      <ToggleGroupItem value="critical">Critical</ToggleGroupItem>
    </ToggleGroup>
  )
}

export function Sizes() {
  return (
    <div className="flex flex-col items-start gap-3">
      <ToggleGroup type="single" defaultValue="week" size="sm" variant="outline">
        <ToggleGroupItem value="week">Week</ToggleGroupItem>
        <ToggleGroupItem value="month">Month</ToggleGroupItem>
        <ToggleGroupItem value="quarter">Quarter</ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}
