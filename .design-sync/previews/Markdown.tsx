import { Markdown } from "@nis2-compass/ui"

export function IncidentReport() {
  return (
    <Markdown className="prose-md w-[420px]">
      {`## Early warning – INC-004

On **26 Sep 2026 at 03:12 CEST**, monitoring detected unauthorised access to the customer file transfer service operated by *Atlas Chemie B.V.*.

- Initial containment applied within 40 minutes
- Affected system isolated from the network
- No evidence yet of data exfiltration

See the [full incident record](/incidents/4) for details.`}
    </Markdown>
  )
}

export function PolicyExcerptWithTable() {
  return (
    <Markdown className="prose-md w-[420px]">
      {`# Access control policy

Access to production systems requires **multi-factor authentication** and is reviewed quarterly.

| Role | Review cadence | Owner |
| --- | --- | --- |
| Administrator | Monthly | IT Security |
| Standard user | Quarterly | Line manager |
| Service account | Quarterly | System owner |

Refer to \`§ 30 Abs. 2 Nr. 1 BSIG\` for the underlying registration obligation.`}
    </Markdown>
  )
}

export function Empty() {
  return <Markdown>{null}</Markdown>
}
