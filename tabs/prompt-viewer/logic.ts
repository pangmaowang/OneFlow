import { useEffect, useState } from "react"

import { storageGet, storageRemove } from "@/lib/chrome-storage"
import { createScopedDebugger } from "@/lib/debug"

import {
  buildExportFileName as buildExportFileNameFromSections,
  buildMarkdownExport as buildMarkdownExportFromSections,
  DIGEST_SNAPSHOT_SECTION,
  SECTION_LIBRARY,
  renderDynamicValue
} from "./sections"
import type { CopyState, LoadState, SectionDescriptor, SectionInstance, ViewerPayload } from "./types"
import { formatKeyLabel } from "./utils"

const debug = createScopedDebugger("tabs/prompt-viewer")

export function useViewerData() {
  const [state, setState] = useState<LoadState>("loading")
  const [payload, setPayload] = useState<ViewerPayload | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      if (typeof chrome === "undefined" || !chrome.runtime?.id) {
        setErrorMessage("This page requires the Chrome extension runtime.")
        setState("error")
        return
      }

      const key = new URLSearchParams(window.location.search).get("key")
      if (!key) {
        setErrorMessage("Missing or invalid result key.")
        setState("error")
        return
      }

      debug("load", { key })

      try {
        const stored = await storageGet<ViewerPayload>(key)
        if (!stored || typeof stored.raw !== "string") {
          throw new Error("Result data not found")
        }

        setPayload(stored)
        setState("ready")
        await storageRemove(key)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        debug("load-error", { message })
        setErrorMessage(message)
        setState("error")
      }
    })()
  }, [])

  return { state, payload, errorMessage }
}

export function useCopy() {
  const [copyState, setCopyState] = useState<CopyState>({ status: "idle" })

  const copy = async (label: string, text: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API not available")
      }
      await navigator.clipboard.writeText(text)
      setCopyState({ target: label, status: "copied" })
      setTimeout(() => setCopyState({ status: "idle" }), 2000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      debug("copy-error", { message })
      setCopyState({ target: label, status: "error" })
      setTimeout(() => setCopyState({ status: "idle" }), 2000)
    }
  }

  return { copyState, copy }
}

export function resolveStructuredPayload(payload: ViewerPayload | null) {
  if (!payload) {
    return undefined
  }

  if (payload.parsed !== undefined) {
    return payload.parsed
  }

  const raw = payload.raw?.trim()
  if (!raw) {
    return undefined
  }

  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      return JSON.parse(raw)
    } catch (error) {
      debug("fallback-parse-error", {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return raw
}

export function buildSections(parsed: unknown) {
  if (parsed === null || parsed === undefined) {
    return [] as SectionInstance[]
  }

  if (Array.isArray(parsed)) {
    return [
      {
        descriptor: {
          key: "root-items",
          title: "Structured items",
          description: "Array output from the automation run.",
          icon: undefined,
          render: (value) => renderDynamicValue(value)
        } satisfies SectionDescriptor,
        value: parsed
      }
    ]
  }

  if (typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean") {
    return [
      {
        descriptor: {
          key: "root-value",
          title: "Result",
          description: "Raw value returned by the automation run.",
          icon: undefined,
          render: (value) => renderDynamicValue(value)
        } satisfies SectionDescriptor,
        value: parsed
      }
    ]
  }

  if (!parsed || typeof parsed !== "object") {
    return [] as SectionInstance[]
  }

  const record = parsed as Record<string, unknown>
  const recognized: SectionInstance[] = []

  if (
    Object.prototype.hasOwnProperty.call(record, "timeframe") ||
    Object.prototype.hasOwnProperty.call(record, "totals")
  ) {
    recognized.push({
      descriptor: DIGEST_SNAPSHOT_SECTION,
      value: {
        timeframe: record.timeframe,
        totals: record.totals
      }
    })
  }

  SECTION_LIBRARY.forEach((section) => {
    if (record[section.key] !== undefined) {
      recognized.push({ descriptor: section, value: record[section.key] })
    }
  })

  const extras = Object.entries(record)
    .filter(
      ([key]) =>
        key !== "timeframe" &&
        key !== "totals" &&
        !SECTION_LIBRARY.some((section) => section.key === key)
    )
    .map(([key, value]) => ({
      descriptor: {
        key,
        title: formatKeyLabel(key),
        description: undefined,
        icon: undefined,
        render: (renderValue: unknown) => renderDynamicValue(renderValue),
        copyValue: (copyValue: unknown) =>
          typeof copyValue === "string" ? copyValue : JSON.stringify(copyValue, null, 2)
      } satisfies SectionDescriptor,
      value
    }))

  return [...recognized, ...extras]
}

export function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp))
}

export function buildMarkdownExport(structured: unknown, payload: ViewerPayload | null) {
  const title = payload?.meta?.taskName ?? "Automation result"
  const generatedAt = payload?.createdAt ? new Date(payload.createdAt).toLocaleString() : null
  const rawOutput = payload?.raw ?? ""
  return buildMarkdownExportFromSections(structured, rawOutput, title, generatedAt)
}

export function buildExportFileName(taskName: string | undefined, extension: string, createdAt?: number) {
  return buildExportFileNameFromSections(taskName, extension, createdAt)
}

export function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.style.display = "none"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

