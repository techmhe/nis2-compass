import { Label, RadioGroup, RadioGroupItem } from "@nis2-compass/ui"

export function Vertical() {
  return (
    <RadioGroup defaultValue="important" className="gap-2">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="essential" id="rg-essential" />
        <Label htmlFor="rg-essential">Essential entity</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="important" id="rg-important" />
        <Label htmlFor="rg-important">Important entity</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="out-of-scope" id="rg-out" />
        <Label htmlFor="rg-out">Out of scope</Label>
      </div>
    </RadioGroup>
  )
}

export function Horizontal() {
  return (
    <RadioGroup defaultValue="significant" className="grid-flow-col gap-5">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="significant" id="rg-sig" />
        <Label htmlFor="rg-sig">Significant</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="minor" id="rg-minor" />
        <Label htmlFor="rg-minor">Minor</Label>
      </div>
    </RadioGroup>
  )
}

export function DisabledItem() {
  return (
    <RadioGroup defaultValue="draft" className="gap-2">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="draft" id="rg-draft" />
        <Label htmlFor="rg-draft">Draft</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="approved" id="rg-approved" disabled />
        <Label htmlFor="rg-approved">Approved (requires sign-off)</Label>
      </div>
    </RadioGroup>
  )
}
