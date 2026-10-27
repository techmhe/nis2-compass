import {
  Button, Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Pill,
} from "@nis2-compass/ui"

export function IncidentSummary() {
  return (
    <Card className="w-[360px]">
      <CardHeader className="border-b pb-6">
        <CardTitle>Incident INC-004</CardTitle>
        <CardDescription>Compromised VPN account used to access engineering file shares</CardDescription>
        <CardAction><Pill tone="alarm">Significant</Pill></CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-[13px] text-ink-2">Aware since 28 Sep 2026, 05:26. Early warning submitted to the competent authority within the 24h window.</p>
      </CardContent>
      <CardFooter className="border-t pt-6">
        <Button variant="outline" size="sm">Open incident</Button>
      </CardFooter>
    </Card>
  )
}

export function StatCard() {
  return (
    <Card className="w-[220px]">
      <CardHeader>
        <CardDescription>Unplanned findings</CardDescription>
        <CardTitle className="text-2xl">257</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-[12.5px] text-ink-3">Not yet included in the action plan</p>
      </CardContent>
    </Card>
  )
}

export function TitleOnly() {
  return (
    <Card className="w-[320px]">
      <CardHeader>
        <CardTitle>Registration status</CardTitle>
        <CardDescription>ATN entity registered with the competent authority on 12 Sep 2026.</CardDescription>
      </CardHeader>
    </Card>
  )
}
