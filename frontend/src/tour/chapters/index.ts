import type { ChapterId, TourChapter } from "../types"
import { admin } from "./admin"
import { answer } from "./answer"
import { assess } from "./assess"
import { audits } from "./audits"
import { controls } from "./controls"
import { documents } from "./documents"
import { incidents } from "./incidents"
import { inventory } from "./inventory"
import { programme } from "./programme"
import { projectChapter } from "./project"
import { quality } from "./quality"
import { risks } from "./risks"
import { suppliers } from "./suppliers"
import { welcome } from "./welcome"

/** Chapters that exist so far; the engine runs only these. Each chapter file adds itself here. */
export const CHAPTERS: Partial<Record<ChapterId, TourChapter>> = {
  welcome,
  answer,
  assess,
  programme,
  project: projectChapter,
  risks,
  controls,
  audits,
  incidents,
  suppliers,
  inventory,
  documents,
  quality,
  admin,
}
