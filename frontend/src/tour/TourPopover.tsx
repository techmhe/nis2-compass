import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import type { TourStep } from "./types"

const PAD = 6
// The popover's size (w-[22rem]; the height of a two-sentence step) and its distance to the anchor and the screen edge.
const POP_W = 352
const POP_H = 220
const GAP = 12
const EDGE = 16

interface Box { top: number; left: number; width: number; height: number }
type Side = "top" | "right" | "bottom" | "left"

/** The part of the box that is on screen. */
function visiblePart(box: Box): Box {
  const top = Math.max(box.top, 0)
  const left = Math.max(box.left, 0)
  const bottom = Math.min(box.top + box.height, window.innerHeight)
  const right = Math.min(box.left + box.width, window.innerWidth)
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/**
 * Where the popover goes: on the first side of the visible box with room for it, so it never ends up off screen.
 * An element that leaves no room on any side (a long table) gets the popover inside its visible part, at the bottom.
 */
function placement(box: Box): { side: Side; rect: Box } {
  const v = visiblePart(box)
  const room: Record<Side, number> = {
    top: v.top, bottom: window.innerHeight - v.top - v.height, left: v.left, right: window.innerWidth - v.left - v.width,
  }
  const need: Record<Side, number> = { top: POP_H + GAP + EDGE, bottom: POP_H + GAP + EDGE, left: POP_W + GAP + EDGE, right: POP_W + GAP + EDGE }
  const order: Side[] = v.left + v.width / 2 < 300 ? ["right", "bottom", "top", "left"] : ["bottom", "top", "right", "left"]
  const side = order.find((s) => room[s] >= need[s])
  if (side) return { side, rect: v }
  return { side: "top", rect: { top: v.top + v.height - EDGE + GAP, left: v.left + EDGE, width: Math.max(0, v.width - 2 * EDGE), height: 0 } }
}

/** The padded box of the anchor element, followed frame by frame (layout shifts while data loads). */
function useAnchorBox(anchor: string): Box | null {
  const [box, setBox] = useState<Box | null>(null)
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const el = [...document.querySelectorAll<HTMLElement>(`[data-tour~="${anchor}"]`)].find((e) => e.getBoundingClientRect().width > 0)
      if (el) {
        const r = el.getBoundingClientRect()
        const next = { top: r.top - PAD, left: r.left - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD }
        setBox((b) => (b && b.top === next.top && b.left === next.left && b.width === next.width && b.height === next.height ? b : next))
      }
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [anchor])
  return box
}

const DIM = "fixed z-[60] bg-sidebar/60"

/**
 * Using the highlighted element (a click in the hole, Enter or Space on a control in it) ends the tour first, so a
 * dialog, menu or popover it opens is not covered by the dim layer, and Esc then closes that layer, not the tour.
 */
function useHoleUse(active: boolean, anchor: string, box: Box | null, popover: React.RefObject<HTMLDivElement | null>, onUse: () => void) {
  const latest = useRef({ box, onUse })
  latest.current = { box, onUse }
  useEffect(() => {
    if (!active) return
    const inPopover = (t: EventTarget | null) => t instanceof Node && !!popover.current?.contains(t)
    const onPointer = (e: PointerEvent) => {
      const b = latest.current.box && visiblePart(latest.current.box)
      if (e.button !== 0 || !b || inPopover(e.target)) return
      if (e.clientX >= b.left && e.clientX <= b.left + b.width && e.clientY >= b.top && e.clientY <= b.top + b.height) latest.current.onUse()
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "Enter" && e.key !== " ") || inPopover(e.target)) return
      const t = e.target instanceof Element ? e.target : null
      const control = t?.closest("button, a, [role='button'], [role='tab'], [role='menuitem']")
      if (control?.closest(`[data-tour~="${anchor}"]`)) latest.current.onUse()
    }
    window.addEventListener("pointerdown", onPointer, true)
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("pointerdown", onPointer, true)
      window.removeEventListener("keydown", onKey, true)
    }
  }, [active, anchor, popover])
}

/** Dims everything except the box. The four panels swallow clicks; the hole between them leaves the element clickable. */
function Spotlight({ box }: { box: Box }) {
  const bottom = box.top + box.height
  const right = box.left + box.width
  return (
    <>
      <div className={DIM} style={{ top: 0, left: 0, right: 0, height: Math.max(0, box.top) }} />
      <div className={DIM} style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <div className={DIM} style={{ top: box.top, left: 0, width: Math.max(0, box.left), height: box.height }} />
      <div className={DIM} style={{ top: box.top, left: right, right: 0, height: box.height }} />
      <div className="pointer-events-none fixed z-[61] rounded-md border-2 border-petrol" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />
    </>
  )
}

function Card({ title, children, footer, titleId, bodyId }: { title: string; children: string; footer: React.ReactNode; titleId: string; bodyId: string }) {
  return (
    <>
      <h2 id={titleId} className="text-[15px] font-semibold text-ink">{title}</h2>
      <p id={bodyId} className="mt-1.5 text-[13.5px] text-ink-2">{children}</p>
      <div className="mt-4 flex items-center gap-2">{footer}</div>
    </>
  )
}

interface LayerProps {
  /** The welcome card, shown instead of a step. */
  intro: { chapters: number; minutes: number } | null
  step: TourStep | null
  anchor: string
  n: number
  m: number
  canBack: boolean
  isLast: boolean
  onNext: () => void
  onBack: () => void
  onEnd: () => void
  onNotNow: () => void
}

export function TourLayer(p: LayerProps) {
  const titleId = useId()
  const bodyId = useId()
  const content = useRef<HTMLDivElement>(null)
  const box = useAnchorBox(p.anchor)
  useHoleUse(!p.intro && !!p.step, p.anchor, box, content, p.onEnd)
  const stepKey = p.intro ? "intro" : p.anchor
  useEffect(() => { content.current?.focus({ preventScroll: true }) }, [stepKey, box === null])
  const place = useMemo(() => (box ? placement(box) : null), [box])
  const virtualRef = useMemo(() => {
    const r = place?.rect
    return { current: { getBoundingClientRect: () => new DOMRect(r?.left ?? 0, r?.top ?? 0, r?.width ?? 0, r?.height ?? 0) } }
  }, [place])

  if (p.intro) {
    const { chapters, minutes } = p.intro
    return (
      <>
        <div className={`${DIM} inset-0`} />
        <div ref={content} role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={bodyId} tabIndex={-1}
          className="fixed top-1/2 left-1/2 z-[70] w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-md border bg-popover p-5 text-popover-foreground shadow-md outline-hidden">
          <Card titleId={titleId} bodyId={bodyId} title="Welcome to NIS2 Compass"
            footer={<div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={p.onNotNow}>Not now</Button>
              <Button size="sm" onClick={p.onNext}>Start tour</Button>
            </div>}>
            {`A short tour shows you around on the real screens: ${chapters} ${chapters === 1 ? "chapter" : "chapters"}, about ${minutes} ${minutes === 1 ? "minute" : "minutes"}. You can end it at any time and restart it from Help.`}
          </Card>
        </div>
      </>
    )
  }
  if (!p.step || !box || !place) return null
  const { step } = p
  const stop = (e: Event) => e.preventDefault()
  return (
    <>
      <Spotlight box={visiblePart(box)} />
      <Popover open modal={false}>
        <PopoverAnchor virtualRef={virtualRef} />
        <PopoverContent ref={content} side={place.side} align="start" sideOffset={GAP} collisionPadding={EDGE} sticky="always" tabIndex={-1}
          aria-labelledby={titleId} aria-describedby={bodyId}
          className="z-[70] w-[22rem] p-4"
          onOpenAutoFocus={(e) => { e.preventDefault(); content.current?.focus({ preventScroll: true }) }}
          onCloseAutoFocus={stop} onEscapeKeyDown={stop} onPointerDownOutside={stop} onFocusOutside={stop} onInteractOutside={stop}>
          <Card titleId={titleId} bodyId={bodyId} title={step.title}
            footer={<>
              <span className="tabular text-[12px] text-ink-3">Step {p.n} of {p.m}</span>
              <div className="ml-auto flex gap-1.5">
                <Button variant="ghost" size="sm" onClick={p.onEnd}>End tour</Button>
                <Button variant="outline" size="sm" disabled={!p.canBack} onClick={p.onBack}>Back</Button>
                <Button size="sm" onClick={p.onNext}>{p.isLast ? "Done" : "Next"}</Button>
              </div>
            </>}>
            {step.body}
          </Card>
        </PopoverContent>
      </Popover>
    </>
  )
}
