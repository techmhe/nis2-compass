import { Switch } from "@nis2-compass/ui"

export function OnOff() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-[13px]"><Switch defaultChecked aria-label="Headquarters" /> On</label>
      <label className="flex items-center gap-2 text-[13px]"><Switch aria-label="Active" /> Off</label>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Switch size="default" defaultChecked aria-label="Default size" />
      <Switch size="sm" defaultChecked aria-label="Small size" />
    </div>
  )
}

export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Switch disabled aria-label="Disabled off" />
      <Switch disabled defaultChecked aria-label="Disabled on" />
    </div>
  )
}

export function Row() {
  return (
    <div className="flex max-w-sm flex-col gap-2">
      <label className="flex items-center justify-between gap-3 rounded-md border bg-surface px-3 py-2">
        <span className="text-[13px]">Headquarters</span>
        <Switch defaultChecked aria-label="Headquarters" />
      </label>
      <label className="flex items-center justify-between gap-3 rounded-md border bg-surface px-3 py-2">
        <span className="text-[13px]">Active</span>
        <Switch defaultChecked aria-label="Active" />
      </label>
    </div>
  )
}
