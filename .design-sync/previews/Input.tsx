import { Field, Input } from "@nis2-compass/ui"

export function Basic() {
  return (
    <div className="grid max-w-sm gap-3">
      <Field label="Finding prefix" hint="Used in finding IDs such as ATL-1.1.1" htmlFor="i-prefix">
        <Input id="i-prefix" defaultValue="ATL" />
      </Field>
      <Field label="Country" hint="Two-letter code" htmlFor="i-country">
        <Input id="i-country" maxLength={2} defaultValue="DE" />
      </Field>
    </div>
  )
}

export function Types() {
  return (
    <div className="grid max-w-sm gap-3">
      <Field label="Registration date" htmlFor="i-date"><Input id="i-date" type="date" defaultValue="2026-09-29" /></Field>
      <Field label="Annual turnover (million EUR)" htmlFor="i-eur"><Input id="i-eur" type="number" min={0} step="0.1" defaultValue="42.5" /></Field>
      <Field label="Contact e-mail" htmlFor="i-mail"><Input id="i-mail" type="email" defaultValue="isb@demo.local" /></Field>
    </div>
  )
}

export function Placeholder() {
  return (
    <div className="max-w-sm">
      <Input placeholder="e.g. Manufacturing of machinery (Annex II, 5(e))" />
    </div>
  )
}

export function InvalidAndDisabled() {
  return (
    <div className="grid max-w-sm gap-3">
      <Field label="Code" htmlFor="i-code-bad">
        <Input id="i-code-bad" defaultValue="" aria-invalid placeholder="Required" />
      </Field>
      <Field label="Sort order" htmlFor="i-sort">
        <Input id="i-sort" type="number" defaultValue="10" disabled />
      </Field>
    </div>
  )
}
