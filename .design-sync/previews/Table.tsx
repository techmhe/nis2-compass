import {
  Code, EntityTag, PriorityPill, StatusPill, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "@nis2-compass/ui"

const ITEMS = [
  { code: "AP-001", entity: "ATN", req: "15.1", title: "Confirm entity classification and competent authority, complete registration", priority: "High", status: "Not Started", due: "–" },
  { code: "AP-005", entity: "ATL", req: "1.1.1", title: "Document the procedure and have it approved by the ISO", priority: "High", status: "In Progress", due: "26 Sep 2026" },
  { code: "AP-006", entity: "ATL", req: "1.1.2", title: "Extend the control to all entities via Central IT", priority: "Medium", status: "Completed", due: "3 Nov 2026" },
  { code: "AP-011", entity: "ATL", req: "2.1.1", title: "Plan and perform an effectiveness test; record results", priority: "Low", status: "Blocked", due: "21 Nov 2026" },
]

export function ActionPlan() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Entity</TableHead>
          <TableHead>Req.</TableHead>
          <TableHead>Measure</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Target date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ITEMS.map((i) => (
          <TableRow key={i.code}>
            <TableCell><Code>{i.code}</Code></TableCell>
            <TableCell><EntityTag code={i.entity} /></TableCell>
            <TableCell><Code>{i.req}</Code></TableCell>
            <TableCell className="max-w-[360px] whitespace-normal">{i.title}</TableCell>
            <TableCell><PriorityPill value={i.priority} /></TableCell>
            <TableCell><StatusPill value={i.status} /></TableCell>
            <TableCell className="text-right tabular-nums">{i.due}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function WithCaption() {
  return (
    <Table>
      <TableCaption>Chapter targets for the 2026 assessment round</TableCaption>
      <TableHeader>
        <TableRow><TableHead>Chapter</TableHead><TableHead className="text-right">Target</TableHead><TableHead className="text-right">Group average</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        <TableRow><TableCell>1 Policy on the security of network and information systems</TableCell><TableCell className="text-right">75%</TableCell><TableCell className="text-right">59%</TableCell></TableRow>
        <TableRow><TableCell>14 Human resources security</TableCell><TableCell className="text-right">100%</TableCell><TableCell className="text-right">82%</TableCell></TableRow>
      </TableBody>
    </Table>
  )
}
