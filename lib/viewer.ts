import { createScopedDebugger } from "@/lib/debug"
import { storageSet } from "@/lib/chrome-storage"

const debug = createScopedDebugger("automation/viewer")

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

export type ViewerOptions = {
  taskId?: string
  taskName?: string
  stepId?: string
}

function ensureChrome() {
  if (typeof chrome === "undefined" || !chrome.runtime?.getURL || !chrome.tabs?.create) {
    throw new Error("Chrome extension APIs are unavailable in this context")
  }
}

function normalizeResult(result: unknown) {
  if (typeof result === "string") {
    const trimmed = result.trim()
    if (!trimmed) {
      return { raw: "" }
    }

    try {
      const parsed = JSON.parse(trimmed)
      return { raw: trimmed, parsed }
    } catch (_) {
      return { raw: trimmed }
    }
  }

  if (result == null) {
    return { raw: "" }
  }

  const raw = JSON.stringify(result, null, 2)
  return { raw, parsed: result }
}

function generateKey() {
  return `viewer_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function buildViewerUrl(key: string) {
  ensureChrome()
  return chrome.runtime.getURL(`tabs/prompt-viewer.html?key=${encodeURIComponent(key)}`)
}

function openViewerTab(key: string) {
  const url = buildViewerUrl(key)
  debug("open-tab", { url })

  chrome.tabs.create({ url }, () => {
    const lastError = chrome.runtime?.lastError
    if (lastError) {
      debug("open-error", { message: lastError.message })
    }
  })
}

async function persistViewerPayload(result: unknown, options: ViewerOptions) {
  ensureChrome()

  const { raw, parsed } = normalizeResult(result)
  const key = generateKey()

  const payload: ViewerPayload = {
    id: key,
    raw,
    parsed,
    createdAt: Date.now(),
    meta: {
      taskId: options.taskId,
      taskName: options.taskName,
      stepId: options.stepId
    }
  }

  debug("store", { key, rawLength: raw.length })

  try {
    await storageSet({ [key]: payload })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    debug("store-error", { message })
    throw error
  }

  return key
}

export async function openAutomationResultViewer(result: unknown, options: ViewerOptions = {}) {
  const key = await persistViewerPayload(result, options)
  openViewerTab(key)
}

export async function stashAutomationResult(result: unknown, options: ViewerOptions = {}) {
  return persistViewerPayload(result, options)
}

export function openStashedAutomationResult(key: string) {
  openViewerTab(key)
}
