import * as React from "react"
import { Combo, Field } from "@nis2-compass/ui"

const STAKEHOLDERS = [
  { value: 1, label: "Mira Jansen", hint: "role" },
  { value: 2, label: "Théo Dubois", hint: "CISO" },
  { value: 3, label: "Anke Verhoeven", hint: "role" },
]

function ResponsibleDemo() {
  const [value, setValue] = React.useState<number | null>(2)
  return <Combo value={value} onChange={setValue} items={STAKEHOLDERS} placeholder="Responsible…" />
}

export function Basic() {
  return (
    <div className="max-w-xs">
      <Field label="Responsible">
        <ResponsibleDemo />
      </Field>
    </div>
  )
}

function EmptyDemo() {
  const [value, setValue] = React.useState<number | null>(null)
  return <Combo value={value} onChange={setValue} items={STAKEHOLDERS} placeholder="Assign to…" />
}

export function Empty() {
  return (
    <div className="max-w-xs">
      <EmptyDemo />
    </div>
  )
}

export function Disabled() {
  return (
    <div className="max-w-xs">
      <Combo value={1} onChange={() => {}} items={STAKEHOLDERS} disabled />
    </div>
  )
}
