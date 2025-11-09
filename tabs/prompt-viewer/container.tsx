import React, { useCallback, useMemo } from "react"

import { createScopedDebugger } from "@/lib/debug"

import "@/style.css"

import {
  buildExportFileName,
  buildMarkdownExport,
  formatDate,
  resolveStructuredPayload,
  triggerDownload,
  useCopy,
  useViewerData,
  buildSections
} from "./logic"
import type { SectionInstance } from "./types"
import { PromptViewerView } from "./view"

const debug = createScopedDebugger("tabs/prompt-viewer")

export function PromptViewerContainer() {
  const { state, payload, errorMessage } = useViewerData()
  const { copyState, copy } = useCopy()

  const structuredPayload = useMemo(() => resolveStructuredPayload(payload), [payload])
  const sections = useMemo<SectionInstance[]>(() => buildSections(structuredPayload), [structuredPayload])

  const handleExportMarkdown = useCallback(() => {
    if (!payload) {
      return
    }

    try {
      const content = buildMarkdownExport(structuredPayload, payload)
      const filename = buildExportFileName(payload.meta?.taskName, "md", payload.createdAt)
      triggerDownload(filename, content, "text/markdown;charset=utf-8")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      debug("export-markdown-error", { message })
    }
  }, [payload, structuredPayload])

  const handleCopy = useCallback(
    (sectionKey: string, value: string) => {
      copy(sectionKey, value)
    },
    [copy]
  )

  const formattedCreatedAt = useMemo(
    () => (payload?.createdAt ? formatDate(payload.createdAt) : undefined),
    [payload?.createdAt]
  )

  return (
    <PromptViewerView
      state={state}
      errorMessage={errorMessage}
      payload={payload}
      sections={sections}
      copyState={copyState}
      onCopy={handleCopy}
      onExportMarkdown={handleExportMarkdown}
      formattedCreatedAt={formattedCreatedAt}
    />
  )
}
