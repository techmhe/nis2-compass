import { ErrorState } from "@nis2-compass/ui"

export function LoadFailure() {
  return <ErrorState error={new Error("Could not load the dashboard")} className="w-[360px]" />
}

export function SaveFailure() {
  return <ErrorState error={new Error("Could not save AP-005: target date must be in the future")} className="w-[360px]" />
}
