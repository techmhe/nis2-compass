import { Checkbox } from "@nis2-compass/ui"

export function States() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-[13px]">
        <Checkbox defaultChecked aria-label="Mark AP-006 as done" /> Checked
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <Checkbox aria-label="Mark AP-010 as done" /> Unchecked
      </label>
    </div>
  )
}

export function InvalidAndDisabled() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-[13px]">
        <Checkbox aria-invalid aria-label="Confirm acknowledgement" /> Invalid
      </label>
      <label className="flex items-center gap-2 text-[13px] opacity-60">
        <Checkbox disabled aria-label="Mark AP-011 as done" /> Disabled
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <Checkbox checked disabled aria-label="Mark AP-005 as done" /> Checked + disabled
      </label>
    </div>
  )
}

export function List() {
  return (
    <ul className="space-y-1.5 text-[13px]">
      <li className="flex items-center gap-2"><Checkbox checked aria-label="Confirm classification" /> Confirm entity classification and competent authority</li>
      <li className="flex items-center gap-2"><Checkbox aria-label="Complete registration" /> Complete registration with the competent authority</li>
      <li className="flex items-center gap-2"><Checkbox aria-label="Notify DPO" /> Notify the DPO of the new processing activity</li>
    </ul>
  )
}
