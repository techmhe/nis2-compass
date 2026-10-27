import { Checkbox, Input, Label } from "@nis2-compass/ui"

export function WithInput() {
  return (
    <div className="grid gap-1.5 max-w-sm">
      <Label htmlFor="l-name">Name</Label>
      <Input id="l-name" defaultValue="NIS2 Group Implementation Project" />
    </div>
  )
}

export function WithCheckbox() {
  return (
    <Label htmlFor="l-check" className="flex items-center gap-2">
      <Checkbox id="l-check" defaultChecked />
      Escalate to the crisis team
    </Label>
  )
}

export function Disabled() {
  return (
    <div className="group flex items-center gap-2" data-disabled="true">
      <Checkbox id="l-disabled" disabled />
      <Label htmlFor="l-disabled">Central at HQ (locked)</Label>
    </div>
  )
}
