import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from "@nis2-compass/ui"
import { ClipboardCheck, FileText, LayoutList, ListChecks, ShieldAlert, UserRound } from "lucide-react"

export function CommandPalette() {
  return (
    <Command className="w-[420px] rounded-lg border shadow-md">
      <CommandInput placeholder="Search actions and entities..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Go to">
          <CommandItem><ClipboardCheck /> Assessments<CommandShortcut>G A</CommandShortcut></CommandItem>
          <CommandItem><LayoutList /> Requirements<CommandShortcut>G R</CommandShortcut></CommandItem>
          <CommandItem><ListChecks /> Action plan<CommandShortcut>G P</CommandShortcut></CommandItem>
          <CommandItem><ShieldAlert /> Risk register<CommandShortcut>G K</CommandShortcut></CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Recent">
          <CommandItem><FileText /> AP-005 Document the procedure and have it approved by the ISO</CommandItem>
          <CommandItem><UserRound /> ATN – Atlas Nederland B.V.</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

export function Empty() {
  return (
    <Command className="w-[380px] rounded-lg border shadow-md">
      <CommandInput placeholder="Search..." defaultValue="asdgh" />
      <CommandList>
        <CommandEmpty>No results for "asdgh".</CommandEmpty>
      </CommandList>
    </Command>
  )
}
