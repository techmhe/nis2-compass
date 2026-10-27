import { Calendar } from "@nis2-compass/ui"

export function Single() {
  return <Calendar mode="single" selected={new Date(2026, 8, 29)} defaultMonth={new Date(2026, 8, 1)} />
}

export function Range() {
  return (
    <Calendar
      mode="range"
      selected={{ from: new Date(2026, 8, 21), to: new Date(2026, 8, 26) }}
      defaultMonth={new Date(2026, 8, 1)}
    />
  )
}

export function Disabled() {
  return (
    <Calendar
      mode="single"
      selected={new Date(2026, 8, 29)}
      defaultMonth={new Date(2026, 8, 1)}
      disabled={{ before: new Date(2026, 8, 29) }}
    />
  )
}
