import * as React from "react"
import { ChipPicker, Code } from "@nis2-compass/ui"

type Requirement = { id: number; code: string; title: string }

const REQUIREMENTS: Requirement[] = [
  { id: 1, code: "1.1.1", title: "Document the information security policy" },
  { id: 2, code: "1.1.2", title: "Extend the control to all entities via Central IT" },
  { id: 3, code: "2.1.1", title: "Plan and perform an effectiveness test" },
  { id: 4, code: "14.2.3", title: "Provide security awareness training to all staff" },
]

function RequirementsDemo() {
  const [value, setValue] = React.useState<number[]>([1, 3])
  return (
    <ChipPicker
      value={value}
      onChange={setValue}
      items={REQUIREMENTS}
      noun="requirement"
      searchPlaceholder="Search requirements…"
      searchText={(r) => `${r.code} ${r.title}`}
      itemLabel={(r) => r.code}
      chip={(r, id) => <Code>{r?.code ?? id}</Code>}
      row={(r) => <span><Code>{r.code}</Code> <span className="ml-1.5">{r.title}</span></span>}
      chipTitle={(r) => r?.title}
    />
  )
}

export function Selected() {
  return <RequirementsDemo />
}

function EmptyDemo() {
  const [value, setValue] = React.useState<number[]>([])
  return (
    <ChipPicker
      value={value}
      onChange={setValue}
      items={REQUIREMENTS}
      noun="requirement"
      searchPlaceholder="Search requirements…"
      searchText={(r) => `${r.code} ${r.title}`}
      itemLabel={(r) => r.code}
      chip={(r, id) => <Code>{r?.code ?? id}</Code>}
      row={(r) => <span><Code>{r.code}</Code> <span className="ml-1.5">{r.title}</span></span>}
    />
  )
}

export function Empty() {
  return <EmptyDemo />
}

export function Disabled() {
  return (
    <ChipPicker
      value={[2, 4]}
      onChange={() => {}}
      items={REQUIREMENTS}
      noun="requirement"
      searchPlaceholder="Search requirements…"
      searchText={(r) => `${r.code} ${r.title}`}
      itemLabel={(r) => r.code}
      chip={(r, id) => <Code>{r?.code ?? id}</Code>}
      row={(r) => <span><Code>{r.code}</Code> <span className="ml-1.5">{r.title}</span></span>}
      disabled
    />
  )
}
