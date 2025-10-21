import {
  formatExtractedContent,
  normalizeExtractedText,
  READ_PAGE_MESSAGE,
  sanitizeHtmlFragment
} from "./extraction"
import type {
  ExtractionResult,
  ReadPageRequest,
  ReadPageResponse
} from "./extraction"
import type {
  ActionExecutionArgs,
  ActionExecutionResult,
  ActionType,
  ReadPageConfig,
  RegisteredAction,
  StructuredPromptConfig,
  SummarizeConfig
} from "./types"
import {
  appendDebugTrace,
  createDebugTrace,
  createScopedDebugger
} from "../debug"

const registry = new Map<ActionType, RegisteredAction<ActionType>>()

export function registerAction<TType extends ActionType>(
  type: TType,
  action: RegisteredAction<TType>
) {
  registry.set(type, action as unknown as RegisteredAction<ActionType>)
}

export function getAction(type: ActionType) {
  return registry.get(type)
}

export function requireAction(type: ActionType) {
  const action = getAction(type)
  if (!action) {
    throw new Error(`Action "${type}" is not registered`)
  }
  return action
}

export function listActions() {
  return Array.from(registry.entries()).map(([type, action]) => ({
    type,
    ...action
  }))
}

// --- Default actions ------------------------------------------------------

registerAction("read-page", {
  name: "Read page",
  description: "Collect content from the active page or provided source",
  run: readPageAction
})

registerAction("summarize-text", {
  name: "Summarize text",
  description: "Condense textual input into key bullet points",
  run: summarizeTextAction
})

registerAction("structured-prompt", {
  name: "Prompt template",
  description: "Render a prompt template with contextual values",
  run: structuredPromptAction
})

// --- Action implementations ----------------------------------------------

async function readPageAction({ step, context }: ActionExecutionArgs<"read-page">) {
  const config: ReadPageConfig = {
    fallback: step.config?.fallback,
    source: step.config?.source,
    selector: step.config?.selector,
    attribute: step.config?.attribute,
    maxLength: step.config?.maxLength
  }

  const meta: Record<string, unknown> = {
    source: config.source ?? "active-tab"
  }
  const debugTrace = createDebugTrace()
  const debugLog = createScopedDebugger("automation/read-page")
  const logDebug = (stage: string, details: Record<string, unknown> = {}) => {
    appendDebugTrace(debugTrace, stage, details)
    debugLog(stage, details)
  }

  logDebug("start", {
    source: config.source ?? "active-tab",
    hasContext: typeof context.pageContent === "string",
    hasFallback: typeof config.fallback === "string"
  })

  const preferSelection = config.source === "selection"
  let rawContent: string | undefined
  let fromExtraction = false
  let extractionError: Error | undefined

  if (!config.source || config.source === "active-tab" || config.source === "selection") {
    try {
      const extraction = await readActiveTabContent({
        selector: config.selector,
        attribute: config.attribute
      })

      const extracted = preferSelection && extraction.selection ? extraction.selection : extraction.body

      if (extracted && extracted.trim().length > 0) {
        rawContent = extracted
        fromExtraction = true
        meta.fromExtraction = true
        logDebug("extraction-success", {
          bodyLength: extracted.length,
          selectionUsed: preferSelection && Boolean(extraction.selection)
        })
      }

      Object.assign(meta, {
        title: extraction.title,
        url: extraction.url,
        rawLength: extraction.rawLength,
        selectionLength: extraction.selectionLength,
        container: extraction.containerTag
      })
    } catch (error) {
      extractionError = error instanceof Error ? error : new Error(String(error))
      meta.error = extractionError.message
      logDebug("extraction-error", {
        message: extractionError.message
      })
    }
  }

  if (!rawContent) {
    if (typeof context.pageContent === "string" && context.pageContent.trim().length > 0) {
      rawContent = context.pageContent
      meta.fromContext = true
      meta.rawLength = context.pageContent.length
      logDebug("using-context", { length: context.pageContent.length })
    } else if (typeof config.fallback === "string" && config.fallback.trim().length > 0) {
      rawContent = config.fallback
      meta.fallbackUsed = true
      meta.rawLength = config.fallback.length
      logDebug("using-fallback", { length: config.fallback.length })
    }
  }

  if (!rawContent) {
    logDebug("no-content", { message: extractionError?.message ?? "missing content" })
    return {
      success: false,
      error: extractionError ?? new Error("No page content available for read-page action"),
      meta: {
        ...meta,
        ...(debugTrace ? { debug: debugTrace } : {})
      }
    }
  }

  const cleaned = fromExtraction
    ? normalizeExtractedText(rawContent)
    : sanitizeHtmlFragment(rawContent)
  const trimmed = cleaned.trim()

  const truncated =
    config.maxLength && trimmed.length > config.maxLength
      ? `${trimmed.slice(0, config.maxLength)}…`
      : trimmed

  const formatted = formatExtractedContent({
    title: typeof meta.title === "string" ? meta.title : undefined,
    url: typeof meta.url === "string" ? meta.url : undefined,
    body: truncated
  })

  const wasTruncated = Boolean(config.maxLength && trimmed.length > config.maxLength)

  logDebug("processed", {
    fromExtraction,
    originalLength: trimmed.length,
    truncated: wasTruncated
  })

  return {
    success: true,
    output: formatted,
    meta: {
      ...meta,
      length: trimmed.length,
      truncated: wasTruncated,
      ...(debugTrace ? { debug: debugTrace } : {})
    }
  }
}

function summarizeTextAction({ input, step }: ActionExecutionArgs<"summarize-text">) {
  const config: SummarizeConfig = {
    maxSentences: step.config?.maxSentences,
    compressionRatio: step.config?.compressionRatio,
    format: step.config?.format
  }

  if (!input || typeof input !== "string") {
    return {
      success: false,
      error: new Error("summarize-text expects a string input")
    }
  }

  const sentences = input
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)

  const dynamicMax =
    config.compressionRatio && config.compressionRatio > 0 && config.compressionRatio < 1
      ? Math.max(1, Math.round(sentences.length * config.compressionRatio))
      : undefined

  const maxSentences = config.maxSentences ?? dynamicMax ?? 2
  const selected = sentences.slice(0, maxSentences)
  const summary = selected.join(" ") || input.slice(0, 280)

  const output =
    config.format === "bullets"
      ? selected.map((sentence) => `• ${sentence.trim()}`).join("\n")
      : summary.trim()

  return {
    success: true,
    output,
    meta: {
      originalSentenceCount: sentences.length,
      returnedSentenceCount: Math.min(sentences.length, maxSentences)
    }
  }
}

function structuredPromptAction({
  input,
  step,
  cache
}: ActionExecutionArgs<"structured-prompt">): ActionExecutionResult<string> {
  const config: StructuredPromptConfig = {
    template: step.config?.template ?? "{{input}}",
    variables: step.config?.variables,
    outputFormat: step.config?.outputFormat ?? "text"
  }

  const replacements = {
    input: typeof input === "string" ? input : JSON.stringify(input, null, 2),
    ...(config.variables ?? {})
  }

  const filled = config.template.replace(/{{\s*(\w+)\s*}}/g, (_, key) => {
    if (replacements[key] !== undefined) {
      return String(replacements[key])
    }

    if (cache.has(key)) {
      const value = cache.get(key)
      return typeof value === "string" ? value : JSON.stringify(value)
    }

    return `{{${key}}}`
  })

  const output =
    config.outputFormat === "json"
      ? JSON.stringify({ prompt: filled }, null, 2)
      : config.outputFormat === "markdown"
      ? `### Prompt\n\n${filled}`
      : filled

  return {
    success: true,
    output,
    meta: {
      format: config.outputFormat
    }
  }
}

async function readActiveTabContent(options: {
  selector?: string
  attribute?: string
}): Promise<ExtractionResult> {
  if (
    typeof chrome === "undefined" ||
    !chrome.tabs?.query ||
    !chrome.tabs?.sendMessage
  ) {
    throw new Error("Browser page access APIs are not available")
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    throw new Error("No active tab available to read")
  }

  const request: ReadPageRequest = {
    type: READ_PAGE_MESSAGE,
    selector: options.selector ?? null,
    attribute: options.attribute ?? null
  }

  const debugLog = createScopedDebugger("automation/read-page")
  debugLog("sendMessage", {
    tabId: tab.id,
    request
  })

  try {
    const response = await new Promise<ReadPageResponse>((resolve, reject) => {
      try {
        chrome.tabs.sendMessage(tab.id as number, request, (res) => {
          const lastError = chrome.runtime?.lastError
          if (lastError) {
            reject(new Error(lastError.message))
            return
          }
          if (!res) {
            reject(new Error("No response from content script"))
            return
          }
          resolve(res as ReadPageResponse)
        })
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })

    debugLog("response", {
      success: response.success,
      hasPayload: Boolean(response.payload),
      error: response.error
    })

    if (!response.success) {
      throw new Error(response.error ?? "Active tab did not provide readable content")
    }

    const payload = response.payload
    if (!payload || typeof payload.body !== "string") {
      throw new Error("Content script returned an invalid payload")
    }

    return payload
  } catch (error) {
    const normalized =
      error instanceof Error && /Receiving end does not exist/i.test(error.message)
        ? new Error("Content script unavailable on this page (Receiving end does not exist)")
        : error instanceof Error
        ? error
        : new Error(String(error))

    throw normalized
  }
}
