import { Code, PriorityPill, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@nis2-compass/ui"

export function AllLevels() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <PriorityPill value="High" />
      <PriorityPill value="Medium" />
      <PriorityPill value="Low" />
    </div>
  )
}

export function InATable() {
  const rows = [
    { code: "AP-001", title: "Confirm entity classification and competent authority", priority: "High" },
    { code: "AP-006", title: "Extend the control to all entities via Central IT", priority: "Medium" },
    { code: "AP-019", title: "Refresh the asset inventory diagram", priority: "Low" },
  ]
  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead>Code</TableHead><TableHead>Measure</TableHead><TableHead>Priority</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.code}>
            <TableCell><Code>{r.code}</Code></TableCell>
            <TableCell>{r.title}</TableCell>
            <TableCell><PriorityPill value={r.priority} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
