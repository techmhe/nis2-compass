import { EntityTag, KeyValue, Section, StatusPill } from "@nis2-compass/ui"

export function ProjectDetails() {
  return (
    <Section title="Project">
      <KeyValue label="Name">NIS2 Group Implementation Project</KeyValue>
      <KeyValue label="Status"><StatusPill value="In Progress" /></KeyValue>
      <KeyValue label="Planned finish">30 Nov 2027</KeyValue>
      <KeyValue label="Sponsor">Group Management Board</KeyValue>
    </Section>
  )
}

export function IncidentDetails() {
  return (
    <Section title="Incident INC-004">
      <KeyValue label="Entity"><EntityTag code="ATC" name="Atlas Chemie B.V." /></KeyValue>
      <KeyValue label="Detected">26 Sep 2026, 03:12</KeyValue>
      <KeyValue label="Significant impact">Yes</KeyValue>
      <KeyValue label="Early warning">Sent 26 Sep 2026, 03:48 (36 min)</KeyValue>
      <KeyValue label="Notes" />
    </Section>
  )
}

export function LongLabelWrap() {
  return (
    <div className="w-72">
      <KeyValue label="Competent authority responsible for supervision">Bundesamt für Sicherheit in der Informationstechnik (BSI)</KeyValue>
      <KeyValue label="Ref.">§ 30 Abs. 2 Nr. 1 BSIG</KeyValue>
    </div>
  )
}
