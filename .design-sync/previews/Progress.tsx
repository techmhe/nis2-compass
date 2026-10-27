import { Progress } from "@nis2-compass/ui"

export function Values() {
  return (
    <div className="w-64 space-y-3">
      <Progress value={15} />
      <Progress value={50} />
      <Progress value={85} />
      <Progress value={100} />
    </div>
  )
}

export function InProjectCard() {
  return (
    <div className="w-72 rounded-md border bg-card p-3">
      <div className="mb-1 flex items-center justify-between text-[13px]">
        <span className="text-ink">Group implementation project</span>
        <span className="tabular text-ink-2">62%</span>
      </div>
      <Progress value={62} />
      <div className="mt-1 text-[12px] text-ink-3">31 of 50 activities completed</div>
    </div>
  )
}

export function Empty() {
  return (
    <div className="w-64">
      <Progress value={0} />
    </div>
  )
}
