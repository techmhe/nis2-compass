import { Button, Empty } from "@nis2-compass/ui"
import { ClipboardList, Plus, Search } from "lucide-react"

export function WithAction() {
  return (
    <Empty
      title="The action plan is empty"
      icon={<ClipboardList className="size-6" />}
      action={<Button size="sm"><Plus /> New item</Button>}
    >
      Bundle findings from the GAP assessment into work packages to build the implementation plan.
    </Empty>
  )
}

export function NoResults() {
  return (
    <Empty title="No matching requirements" icon={<Search className="size-6" />}>
      Adjust the chapter, status or search filters to see more results.
    </Empty>
  )
}

export function TitleOnly() {
  return <Empty title="No suppliers registered yet" />
}
