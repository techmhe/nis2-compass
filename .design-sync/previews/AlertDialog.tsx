import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Button,
} from "@nis2-compass/ui"

export function DeleteRisk() {
  return (
    <AlertDialog defaultOpen>
      <AlertDialogTrigger asChild><Button variant="destructive">Delete risk</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete risk RSK-012?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes "Compromised VPN account used to access engineering file shares" and its treatment plan.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-alarm hover:bg-alarm/90">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function LeaveWithoutSaving() {
  return (
    <AlertDialog defaultOpen>
      <AlertDialogTrigger asChild><Button variant="outline">Close editor</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>Your edits to AP-005 have not been saved yet.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction>Discard</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
