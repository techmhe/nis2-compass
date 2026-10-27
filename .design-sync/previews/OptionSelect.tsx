import * as React from "react"
import { Field, OptionSelect } from "@nis2-compass/ui"

const STATUS_OPTIONS = ["Not Started", "In Progress", "Completed"]
const PRIORITY_OPTIONS = ["Low", "Medium", "High"]

function StatusDemo() {
  const [value, setValue] = React.useState<string | null>("In Progress")
  return <OptionSelect value={value} onChange={setValue} options={STATUS_OPTIONS} />
}

export function Basic() {
  return (
    <div className="max-w-xs">
      <Field label="Status">
        <StatusDemo />
      </Field>
    </div>
  )
}

function AllowNoneDemo() {
  const [value, setValue] = React.useState<string | null>(null)
  return <OptionSelect value={value} onChange={setValue} options={PRIORITY_OPTIONS} allowNone noneLabel="Not set" placeholder="Priority…" />
}

export function AllowNone() {
  return (
    <div className="max-w-xs">
      <Field label="Priority">
        <AllowNoneDemo />
      </Field>
    </div>
  )
}

export function SmallSize() {
  return (
    <div className="max-w-[220px]">
      <OptionSelect value="Completed" onChange={() => {}} options={STATUS_OPTIONS} size="sm" />
    </div>
  )
}

export function Disabled() {
  return (
    <div className="max-w-xs">
      <OptionSelect value="High" onChange={() => {}} options={PRIORITY_OPTIONS} disabled />
    </div>
  )
}
