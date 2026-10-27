import { Code, EntityTag, StatusPill, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@nis2-compass/ui"

export function Entities() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <EntityTag code="ATL" name="Atlas Fertigung GmbH" />
      <EntityTag code="ATS" name="Atlas Service GmbH" />
      <EntityTag code="ATN" name="Atlas Nederland B.V." />
      <EntityTag code="ATC" name="Atlas Chemie B.V." />
    </div>
  )
}

export function NoName() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <EntityTag code="ATL" />
      <EntityTag code="ATN" />
    </div>
  )
}

export function InATable() {
  const rows = [
    { entity: "ATL", name: "Atlas Fertigung GmbH", req: "1.1.1", status: "Completed" },
    { entity: "ATN", name: "Atlas Nederland B.V.", req: "5.2.1", status: "In Progress" },
    { entity: "ATC", name: "Atlas Chemie B.V.", req: "8.1.3", status: "Not Started" },
  ]
  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead>Entity</TableHead><TableHead>Req.</TableHead><TableHead>Status</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.entity}>
            <TableCell><EntityTag code={r.entity} name={r.name} /></TableCell>
            <TableCell><Code>{r.req}</Code></TableCell>
            <TableCell><StatusPill value={r.status} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
