import { Toggle } from "@nis2-compass/ui"
import { Bold, Italic, Star, Underline } from "lucide-react"

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle defaultPressed aria-label="Bold"><Bold /></Toggle>
      <Toggle aria-label="Italic"><Italic /></Toggle>
      <Toggle variant="outline" defaultPressed aria-label="Underline"><Underline /></Toggle>
      <Toggle variant="outline" aria-label="Star"><Star /></Toggle>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle size="sm" defaultPressed>Sm</Toggle>
      <Toggle size="default" defaultPressed>Default</Toggle>
      <Toggle size="lg" defaultPressed>Lg</Toggle>
    </div>
  )
}

export function WithLabel() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle variant="outline" defaultPressed>Flag for review</Toggle>
      <Toggle variant="outline">Watch entity</Toggle>
    </div>
  )
}
