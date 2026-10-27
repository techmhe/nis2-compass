import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
  DropdownMenuTrigger, UserAvatar,
} from "@nis2-compass/ui"
import { BookOpen, KeyRound, LogOut, Monitor, Moon, Sun } from "lucide-react"

export function AccountMenu() {
  return (
    <DropdownMenu open>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted" aria-label="Account menu">
          <UserAvatar name="Isabel Schmidt" className="size-7" />
          <span className="text-left leading-tight">
            <span className="block text-[13px] font-medium text-ink">Isabel Schmidt</span>
            <span className="block text-[11px] text-ink-3">ISO</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="text-[13px] font-medium">Isabel Schmidt</div>
          <div className="text-[12px] text-ink-3">isb@demo.local</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem><KeyRound /> Profile & security</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger><Moon /> Theme</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value="dark">
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem><BookOpen /> Help & scoring model</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function RowActions() {
  return (
    <DropdownMenu open>
      <DropdownMenuTrigger asChild><Button variant="outline" size="sm">Actions</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem>Edit item</DropdownMenuItem>
        <DropdownMenuItem>Duplicate</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-alarm">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
