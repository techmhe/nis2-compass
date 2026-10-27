import * as React from "react"
import { Field, Segmented, answerTone } from "@nis2-compass/ui"

const IMPL_VALUES = ["No", "Partial", "Yes", "N/A"] as const
const SCOPE_VALUES = ["Local", "Central at HQ"] as const

function ImplementedDemo() {
  const [value, setValue] = React.useState<string | null>("Partial")
  return <Segmented size="sm" options={IMPL_VALUES} value={value} toneOf={answerTone} onChange={setValue} />
}

export function Answer() {
  return (
    <div className="max-w-sm">
      <Field label="Implemented" hint="Keys 1 to 4">
        <ImplementedDemo />
      </Field>
    </div>
  )
}

function ScopeDemo() {
  const [value, setValue] = React.useState<string | null>("Central at HQ")
  return <Segmented size="sm" options={SCOPE_VALUES} value={value} onChange={setValue} />
}

export function Scope() {
  return (
    <div className="max-w-sm">
      <Field label="Scope">
        <ScopeDemo />
      </Field>
    </div>
  )
}

export function MediumSize() {
  return <Segmented size="md" options={["Yes", "Partial", "No", "Not Tested"]} value="Yes" toneOf={answerTone} onChange={() => {}} />
}

export function Disabled() {
  return <Segmented size="sm" options={IMPL_VALUES} value="Yes" toneOf={answerTone} disabled onChange={() => {}} />
}
