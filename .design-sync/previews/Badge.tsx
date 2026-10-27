import { Badge } from "@nis2-compass/ui"

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="ghost">Ghost</Badge>
      <Badge variant="link">Link</Badge>
    </div>
  )
}

export function WithIcon() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">v2.3</Badge>
      <Badge variant="outline">Beta</Badge>
      <Badge variant="destructive">2 overdue</Badge>
    </div>
  )
}
