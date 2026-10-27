import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from "@nis2-compass/ui"
import { Check } from "lucide-react"

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Avatar size="sm"><AvatarFallback>JD</AvatarFallback></Avatar>
      <Avatar><AvatarFallback>MK</AvatarFallback></Avatar>
      <Avatar size="lg"><AvatarFallback>AV</AvatarFallback></Avatar>
    </div>
  )
}

// self-contained placeholder portrait (no external image host)
const PORTRAIT = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0d6770"/>'
  + '<circle cx="32" cy="25" r="11" fill="#e3f0f0"/><path d="M12 60c2-12 11-18 20-18s18 6 20 18z" fill="#e3f0f0"/></svg>',
)

export function WithImage() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Avatar>
        <AvatarImage src={PORTRAIT} alt="Julia Decker" />
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>MK</AvatarFallback>
      </Avatar>
    </div>
  )
}

export function WithBadge() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Avatar>
        <AvatarFallback>JD</AvatarFallback>
        <AvatarBadge><Check /></AvatarBadge>
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>AV</AvatarFallback>
        <AvatarBadge className="bg-alarm" />
      </Avatar>
    </div>
  )
}

export function Group() {
  return (
    <AvatarGroup>
      <Avatar><AvatarFallback>JD</AvatarFallback></Avatar>
      <Avatar><AvatarFallback>MK</AvatarFallback></Avatar>
      <Avatar><AvatarFallback>AV</AvatarFallback></Avatar>
      <AvatarGroupCount>+4</AvatarGroupCount>
    </AvatarGroup>
  )
}
