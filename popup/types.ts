import type { LucideIcon } from "lucide-react"

import type { PresetId } from "@/lib/automation"

export type QuickAction = {
  label: string
  description: string
  icon: LucideIcon
  className?: string
  iconClassName?: string
  presetId?: PresetId
  initialInput?: unknown
}

export type QuickActionStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "queued"; queuedCount: number }
  | { state: "failed" }

export type QuickActionWithStatus = QuickAction & {
  status: QuickActionStatus
}

export type StepRunStatus = "pending" | "running" | "succeeded" | "failed"

export type WorkflowStepSnapshot = {
  key: string
  index: number
  stepId?: string
  type: string
  description?: string
  status: StepRunStatus
  outputPreview?: string | null
  meta?: Record<string, unknown>
  error?: string | null
  startedAt?: number
  finishedAt?: number
}

export type ReadMetaInfo = {
  url?: string
  title?: string
  length?: number
  truncated: boolean
  fallbackUsed: boolean
  debug?: string[]
} | null

export type PromptDiagnostics = {
  usedPromptApi: boolean
  fallbackUsed: boolean
  fallbackReason?: string
  viewerKey?: string
  viewerAvailable: boolean
} | null

export type WorkflowStepPatch = {
  status?: StepRunStatus
  outputPreview?: string | null
  meta?: Record<string, unknown> | null
  error?: string | null
  startedAt?: number
  finishedAt?: number
}
