import { UserAvatar } from "@nis2-compass/ui"

export function Names() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <UserAvatar name="Julia Decker" />
      <UserAvatar name="Mark Kowalski" />
      <UserAvatar name="Anke Vermeer" />
      <UserAvatar name="Tom Nguyen" />
    </div>
  )
}

export function InCommentThread() {
  return (
    <div className="w-80 space-y-3">
      <div className="flex gap-2.5">
        <UserAvatar name="Julia Decker" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12px] text-ink-3">
            <span className="font-medium text-ink-2">Julia Decker</span>
            <span>2 days ago</span>
          </div>
          <p className="text-[13px] text-ink">Uploaded the updated access control policy for review.</p>
        </div>
      </div>
      <div className="flex gap-2.5">
        <UserAvatar name="Mark Kowalski" className="size-6" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12px] text-ink-3">
            <span className="font-medium text-ink-2">Mark Kowalski</span>
            <span>yesterday</span>
          </div>
          <p className="text-[13px] text-ink">Looks good, approving on behalf of the ISO.</p>
        </div>
      </div>
    </div>
  )
}
