// Public entry of the NIS2 Compass component library, built by `npm run build:ds` for Claude Design
// (design-sync). The app itself does not import this file. Data-bound components (user/entity pickers,
// comments, document links, uploads) are deliberately not exported.
import "../index.css"

export { DesignSystemProvider } from "./provider"
export * as Icons from "./icons"

// shadcn/radix primitives
export {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogMedia, AlertDialogOverlay, AlertDialogPortal, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
export { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from "@/components/ui/avatar"
export { Badge } from "@/components/ui/badge"
export { Button } from "@/components/ui/button"
export { Calendar } from "@/components/ui/calendar"
export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
export { Checkbox } from "@/components/ui/checkbox"
export { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
export {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
export {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
export {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
export { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
export { Input } from "@/components/ui/input"
export { Label } from "@/components/ui/label"
export {
  Popover, PopoverAnchor, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger,
} from "@/components/ui/popover"
export { Progress } from "@/components/ui/progress"
export { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
export { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
export {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton,
  SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select"
export { Separator } from "@/components/ui/separator"
export {
  Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet"
export { Skeleton } from "@/components/ui/skeleton"
export { Switch } from "@/components/ui/switch"
export {
  Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
export { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
export { Textarea } from "@/components/ui/textarea"
export { Toggle } from "@/components/ui/toggle"
export { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

// NIS2 Compass building blocks
export {
  Code, Empty, EntityTag, ErrorState, KV, KV as KeyValue, Loading, Meter, PageHeader, Pill, PriorityPill, ScoreBar,
  ScoreChip, Section, Stat, StatusPill,
} from "@/components/common/basics"
export { ChipPicker } from "@/components/ui/chip-picker"
export { Confirm, Markdown, UserAvatar } from "@/components/common/collab"
export { Combo, Field, OptionSelect, Segmented } from "@/components/common/fields"
