import type { TaskDefinition } from "@/lib/automation"

import { MAX_DEBUG_ENTRIES, PREVIEW_LIMIT } from "../config"
import type { WorkflowStepSnapshot } from "../types"

export function resolveDebugEnvFlag(): boolean {
  const processEnv =
    typeof process !== "undefined" &&
    (process.env as Record<string, string | undefined> | undefined)

  if (processEnv?.PLASMO_PUBLIC_AUTOMATION_DEBUG === "true") {
    return true
  }

  try {
    const metaEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env
    if (metaEnv?.PLASMO_PUBLIC_AUTOMATION_DEBUG === "true") {
      return true
    }
  } catch (_error) {
    // import.meta can be undefined outside bundler context
  }

  return false
}

export function initializeStepSnapshots(task: TaskDefinition): WorkflowStepSnapshot[] {
  return task.steps.map((step, index) => ({
    key: step.id ?? `${step.type}-${index}`,
    index,
    stepId: step.id,
    type: step.type,
    description: step.description,
    status: "pending"
  }))
}

export function formatOutputPreview(output: unknown): string | null {
  if (output == null) {
    return null
  }

  if (typeof output === "string") {
    const trimmed = output.trim()
    if (!trimmed) {
      return null
    }
    return trimmed.length > PREVIEW_LIMIT ? `${trimmed.slice(0, PREVIEW_LIMIT)}…` : trimmed
  }

  try {
    const serialized = JSON.stringify(output, null, 2)
    return serialized.length > PREVIEW_LIMIT ? `${serialized.slice(0, PREVIEW_LIMIT)}…` : serialized
  } catch (_error) {
    return String(output)
  }
}

export function summarizeStepMeta(
  meta: unknown,
  debugMode: boolean
): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object") {
    return null
  }

  const record = meta as Record<string, unknown>
  const summary: Record<string, unknown> = {}

  if (typeof record.viewerKey === "string") {
    summary.viewerKey = record.viewerKey
  }
  if (record.fallbackUsed) {
    summary.fallbackUsed = true
    if (typeof record.fallbackReason === "string") {
      summary.fallbackReason = record.fallbackReason
    }
  }
  if (typeof record.usedPromptApi === "boolean") {
    summary.usedPromptApi = record.usedPromptApi
  }
  if (typeof record.rawPreview === "string" && record.rawPreview) {
    summary.rawPreview = record.rawPreview
  }
  if (typeof record.normalizedPreview === "string" && record.normalizedPreview) {
    summary.normalizedPreview = record.normalizedPreview
  }
  if (typeof record.artifactId === "string") {
    summary.artifactId = record.artifactId
  }
  if (typeof record.artifactType === "string") {
    summary.artifactType = record.artifactType
  }
  if (typeof record.viewerAvailable === "boolean") {
    summary.viewerAvailable = record.viewerAvailable
  }
  if (typeof record.rawLength === "number") {
    summary.rawLength = record.rawLength
  }
  if (record.parsed) {
    summary.parsed = true
    if (typeof record.parsedSource === "string") {
      summary.parsedSource = record.parsedSource
    }
  } else if (typeof record.parsed === "boolean") {
    summary.parsed = false
  }
  if (Array.isArray(record.normalizedFields) && record.normalizedFields.length > 0) {
    summary.normalizedFields = record.normalizedFields
  }

  if (debugMode) {
    if (Array.isArray(record.debug) && record.debug.length > 0) {
      summary.debug = record.debug.slice(-MAX_DEBUG_ENTRIES)
    }
    if (typeof record.promptLength === "number") {
      summary.promptLength = record.promptLength
    }
    if (typeof record.resultLength === "number") {
      summary.resultLength = record.resultLength
    }
    if (record.expectsJson) {
      summary.expectsJson = record.expectsJson
    }
  }

  return Object.keys(summary).length > 0 ? summary : null
}
