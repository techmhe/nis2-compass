import { Code, EntityTag, ScoreChip, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@nis2-compass/ui"

export function Scale() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ScoreChip value={0.08} />
      <ScoreChip value={0.28} />
      <ScoreChip value={0.48} />
      <ScoreChip value={0.68} />
      <ScoreChip value={0.88} />
      <ScoreChip value={1} />
    </div>
  )
}

export function Empty() {
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink-2">
      Not yet assessed: <ScoreChip value={null} />
    </div>
  )
}

export function InATable() {
  const rows = [
    { entity: "ATL", req: "1.1.1", title: "Information security policy is approved", score: 0.9 },
    { entity: "ATN", req: "5.2.1", title: "Supplier risk register is maintained", score: 0.45 },
    { entity: "ATS", req: "8.1.3", title: "Access reviews performed quarterly", score: null as number | null },
  ]
  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead>Entity</TableHead><TableHead>Req.</TableHead><TableHead>Requirement</TableHead><TableHead className="text-right">Score</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.req}>
            <TableCell><EntityTag code={r.entity} /></TableCell>
            <TableCell><Code>{r.req}</Code></TableCell>
            <TableCell>{r.title}</TableCell>
            <TableCell className="text-right"><ScoreChip value={r.score} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
