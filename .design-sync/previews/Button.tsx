import { Button } from "@nis2-compass/ui"
import { Download, Plus, RefreshCw, Trash2 } from "lucide-react"

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Create work package</Button>
      <Button variant="outline">Export workbook</Button>
      <Button variant="secondary">Save draft</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="destructive">Delete risk</Button>
      <Button variant="link">Open master plan</Button>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="lg">Sign in</Button>
      <Button>Save changes</Button>
      <Button size="sm">Mark as submitted</Button>
      <Button size="xs" variant="outline">Change target</Button>
    </div>
  )
}

export function WithIcons() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button><Plus /> New item</Button>
      <Button variant="outline"><Download /> Export workbook</Button>
      <Button variant="outline" size="sm"><RefreshCw /> Run again</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Delete"><Trash2 /></Button>
    </div>
  )
}

export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled>Creating…</Button>
      <Button variant="outline" disabled>Rebuild index</Button>
    </div>
  )
}
