import type { LucideIcon } from "lucide-react"
import type React from "react"

export type ViewerPayload = {
  id: string
  raw: string
  parsed?: unknown
  createdAt: number
  meta?: {
    taskId?: string
    taskName?: string
    stepId?: string
  }
}

export type LoadState = "loading" | "ready" | "error"

export type CopyState = {
  target?: string
  status: "idle" | "copied" | "error"
}

export type SectionDescriptor = {
  key: string
  title: string
  description?: string
  icon?: LucideIcon
  render: (value: unknown) => React.ReactNode
  copyValue?: (value: unknown) => string | null
}

export type SectionInstance = {
  descriptor: SectionDescriptor
  value: unknown
}

type SnapshotStat = {
  key: string
  label: string
  value: string
}

export type DigestSnapshot = {
  label?: string
  detail?: string
  startLabel?: string
  endLabel?: string
  stats: SnapshotStat[]
}

export type TagStat = {
  tag: string
  count: number
}

export type SpotlightArticle = {
  id: string
  date?: string
  summary: string
  tags: string[]
  keyInsights: string[]
  technicalHighlights: string[]
  supportingLinks: string[]
  sourceUrl?: string
}

export type BlogCollectionEntry = {
  id: string
  summary: string
  keyInsights: string[]
  supportingLinks: string[]
  dateLabel?: string
}

export type BlogCollection = {
  id: string
  label: string
  tag: string
  synopsis: string
  entries: BlogCollectionEntry[]
}
