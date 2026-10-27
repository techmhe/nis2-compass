import { Code, StatusPill, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@nis2-compass/ui"

export function WorkflowStatuses() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill value="Not Started" />
      <StatusPill value="In Progress" />
      <StatusPill value="Completed" />
      <StatusPill value="Blocked" />
      <StatusPill value="Deferred" />
      <StatusPill value="Cancelled" />
    </div>
  )
}

export function DueAndDocumentStatuses() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill value="Overdue" />
      <StatusPill value="Due soon" />
      <StatusPill value="On track" />
      <StatusPill value="Draft" />
      <StatusPill value="In Review" />
      <StatusPill value="Approved" />
      <StatusPill value="Retired" />
    </div>
  )
}

export function IncidentStatuses() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill value="Open" />
      <StatusPill value="Contained" />
      <StatusPill value="Resolved" />
      <StatusPill value="Escalated" />
      <StatusPill value="Critical" />
    </div>
  )
}

export function InATable() {
  const rows = [
    { code: "AP-005", req: "1.1.1", title: "Document the access control procedure", status: "In Progress" },
    { code: "AP-011", req: "2.1.1", title: "Plan and perform an effectiveness test", status: "Blocked" },
    { code: "AP-014", req: "5.2.3", title: "Renew supplier security addendum", status: "Overdue" },
  ]
  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead>Code</TableHead><TableHead>Req.</TableHead><TableHead>Measure</TableHead><TableHead>Status</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.code}>
            <TableCell><Code>{r.code}</Code></TableCell>
            <TableCell><Code>{r.req}</Code></TableCell>
            <TableCell>{r.title}</TableCell>
            <TableCell><StatusPill value={r.status} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function Empty() {
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink-2">
      No status recorded: <StatusPill value={null} />
    </div>
  )
}
