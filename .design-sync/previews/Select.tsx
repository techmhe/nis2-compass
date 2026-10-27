import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nis2-compass/ui"

export function Basic() {
  return (
    <Select defaultValue="in-progress">
      <SelectTrigger className="w-[220px]">
        <SelectValue placeholder="Status…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="not-started">Not Started</SelectItem>
        <SelectItem value="in-progress">In Progress</SelectItem>
        <SelectItem value="completed">Completed</SelectItem>
      </SelectContent>
    </Select>
  )
}

export function SmallSize() {
  return (
    <Select defaultValue="pgn">
      <SelectTrigger size="sm" className="w-[180px]">
        <SelectValue placeholder="Entity…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="atl">ATL</SelectItem>
        <SelectItem value="ats">ATS</SelectItem>
        <SelectItem value="atn">ATN</SelectItem>
        <SelectItem value="atc">ATC</SelectItem>
      </SelectContent>
    </Select>
  )
}

export function Placeholder() {
  return (
    <Select>
      <SelectTrigger className="w-[220px]">
        <SelectValue placeholder="Select an entity…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="atl">ATL</SelectItem>
        <SelectItem value="ats">ATS</SelectItem>
      </SelectContent>
    </Select>
  )
}

export function Disabled() {
  return (
    <Select defaultValue="high" disabled>
      <SelectTrigger className="w-[180px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="low">Low</SelectItem>
        <SelectItem value="high">High</SelectItem>
      </SelectContent>
    </Select>
  )
}
