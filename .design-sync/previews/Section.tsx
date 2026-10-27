import { Button, KeyValue, Section, StatusPill } from "@nis2-compass/ui"

export function WithTitle() {
  return (
    <Section title="Project">
      <KeyValue label="Name">NIS2 Group Implementation Project</KeyValue>
      <KeyValue label="Status"><StatusPill value="In Progress" /></KeyValue>
      <KeyValue label="Planned finish">30 Nov 2027</KeyValue>
      <KeyValue label="Sponsor">Group Management Board</KeyValue>
    </Section>
  )
}

export function WithActions() {
  return (
    <Section title="Gates" actions={<Button variant="link" size="sm">Manage gates</Button>}>
      <p className="text-[13px] text-ink-2">Gate 1 · Approve project charter, assessment method, benchmark and target levels. 3 of 3 gate activities open.</p>
    </Section>
  )
}

export function Flush() {
  return (
    <Section title="Overdue action plan items" bodyClassName="p-0">
      <ul className="divide-y text-[13px]">
        <li className="flex justify-between px-4 py-2"><span>AP-005 Document the procedure and have it approved by the ISO</span><span className="text-alarm">26 Sep 2026</span></li>
        <li className="flex justify-between px-4 py-2"><span>AP-010 Plan and perform an effectiveness test</span><span className="text-alarm">13 Sep 2026</span></li>
      </ul>
    </Section>
  )
}
