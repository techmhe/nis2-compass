import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Button, Confirm,
} from "@nis2-compass/ui"

// Confirm has no `open`/`defaultOpen` prop (it always mounts its own uncontrolled AlertDialog), so the open
// state is composed here from the same AlertDialog parts Confirm renders internally, matching its defaults
// (Cancel + destructive Action button). See .design-sync/learnings/overlays.md.
export function DeleteRisk() {
  return (
    <AlertDialog defaultOpen>
      <AlertDialogTrigger asChild><Button variant="destructive">Delete risk</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete risk RSK-012?</AlertDialogTitle>
          <AlertDialogDescription>This removes the risk and its treatment plan. This action cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-alarm hover:bg-alarm/90">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function ClosedTrigger() {
  return (
    <Confirm
      trigger={<Button variant="outline">Remove supplier link</Button>}
      title="Remove supplier link?"
      description="This unlinks the supplier from the current requirement; the supplier record itself is kept."
      confirmLabel="Remove"
      onConfirm={() => {}}
    />
  )
}
