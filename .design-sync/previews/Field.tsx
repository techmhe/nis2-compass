import { Field, Input, OptionSelect, Textarea } from "@nis2-compass/ui"

const CLASS_OPTIONS = ["Essential", "Important", "Out of scope"]

export function Basic() {
  return (
    <div className="max-w-sm">
      <Field label="Target date" htmlFor="f-target">
        <Input id="f-target" type="date" defaultValue="2026-11-30" />
      </Field>
    </div>
  )
}

export function WithHint() {
  return (
    <div className="max-w-sm">
      <Field label="Finding prefix" hint="Used in finding IDs such as ATL-1.1.1" htmlFor="f-prefix">
        <Input id="f-prefix" defaultValue="ATL" />
      </Field>
    </div>
  )
}

export function WithSelect() {
  return (
    <div className="max-w-sm">
      <Field label="NIS2 classification">
        <OptionSelect value="Essential" onChange={() => {}} options={CLASS_OPTIONS} />
      </Field>
    </div>
  )
}

export function Grid() {
  return (
    <div className="grid max-w-md grid-cols-2 gap-3">
      <Field label="Name" className="col-span-2" htmlFor="f-name">
        <Input id="f-name" defaultValue="Atlas Nederland" />
      </Field>
      <Field label="Code" htmlFor="f-code"><Input id="f-code" defaultValue="ATN" /></Field>
      <Field label="Country" hint="Two-letter code" htmlFor="f-country"><Input id="f-country" maxLength={2} defaultValue="NL" /></Field>
      <Field label="Notes" className="col-span-2" htmlFor="f-notes"><Textarea id="f-notes" rows={2} defaultValue="Registered with the Dutch competent authority." /></Field>
    </div>
  )
}
