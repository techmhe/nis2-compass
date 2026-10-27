import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
  Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@nis2-compass/ui"

export function NewWorkPackage() {
  return (
    <Dialog defaultOpen>
      <DialogTrigger asChild><Button>New work package</Button></DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>New work package</DialogTitle>
          <DialogDescription>Create a work package under the action plan item AP-005.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <Field label="Title">
            <Input defaultValue="Draft the VPN access procedure" />
          </Field>
          <Field label="Owner">
            <Select defaultValue="mh">
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mh">Isabel Schmidt</SelectItem>
                <SelectItem value="jd">J. de Vries</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Target date" hint="Within the parent item's window (26 Sep 2026)">
            <Input type="date" defaultValue="2026-09-20" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Create work package</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Small() {
  return (
    <Dialog defaultOpen>
      <DialogTrigger asChild><Button variant="outline">Rename entity</Button></DialogTrigger>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>Rename entity</DialogTitle>
        </DialogHeader>
        <Field label="Display name">
          <Input defaultValue="ATN – Atlas Nederland B.V." />
        </Field>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
