import { Button, PageHeader, Pill } from "@nis2-compass/ui"
import { Download, Plus } from "lucide-react"

export function WithActions() {
  return (
    <PageHeader
      title="Action plan"
      description="Consolidated remediation measures for all findings of the GAP assessment, with owner, target date and link to the implementation work packages."
      actions={
        <>
          <Button variant="outline"><Download /> Export workbook</Button>
          <Button><Plus /> New item</Button>
        </>
      }
    />
  )
}

export function TitleOnly() {
  return <PageHeader title="Data quality" description="Plausibility checks across assessments, action plan, project and documents." />
}

export function WithMeta() {
  return (
    <PageHeader title="INC-004 Compromised VPN account used to access engineering file shares"
      actions={<Button variant="outline" size="sm">Edit</Button>}>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Pill tone="alarm">Significant</Pill>
        <Pill tone="amber">Open</Pill>
        <span className="text-[12.5px] text-ink-3">Aware since 28 Sep 2026, 05:26</span>
      </div>
    </PageHeader>
  )
}
