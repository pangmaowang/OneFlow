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
  BlogPromptConfig,
  ReadPageConfig,
  RegisteredAction,
  StructuredPromptConfig
} from "./types"
import {
  appendDebugTrace,
  createDebugTrace,
  createScopedDebugger
} from "../debug"
import { openStashedAutomationResult, stashAutomationResult } from "../viewer"
import { listArtifacts, saveArtifact, type StoredArtifactRecord } from "../storage"
import {
  ACTION_METADATA,
  BLOG_PROMPT_DEFAULT_FORMAT,
  BLOG_PROMPT_DEFAULT_SCHEMA,
  BLOG_PROMPT_DEFAULT_TEMPLATE,
  BLOG_DIGEST_MAX_ENTRIES_MULTIPLIER,
  BLOG_DIGEST_TOP_TAGS_LIMIT,
  DAY_IN_MS,
  DEFAULT_BLOG_DIGEST_DAYS,
  DEFAULT_WEEKLY_SUMMARY_DAYS,
  WEEKLY_SUMMARY_MAX_ENTRIES_MULTIPLIER
} from "./config/action-config"
import type {
  BlogDigestEntry,
  BlogDigestResult,
  BlogTagSummary,
  NormalizedStructuredResult,
  PromptApiNamespace,
  PromptApiSession,
  WeeklyRecapEntry
} from "./action-types"
import {
  buildBlogCollections,
  buildBlogDigestSummary,
  buildBlogTagIndex,
  buildPreview,
  buildPromptPayload,
  buildSpotlightArticles,
  buildStoredPayload,
  buildTagSummaries,
  buildWeeklyPromptSection,
  collectSupportingLinks,
  coerceJsonLike,
  deriveRecommendedAngles,
  formatDateRange,
  formatTemplateOutput,
  normalizeBlogDigest,
  normalizeStructuredOutput,
  normalizeWeeklyRecap,
  renderPromptTemplate,
  resolveLanguageModelNamespace
} from "./utils/action-utils"

const registry = new Map<ActionType, RegisteredAction<ActionType>>()
const storeArtifactDebug = createScopedDebugger("automation/store-artifact")
const collectBlogDebug = createScopedDebugger("automation/collect-blog-digest")

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
  ...ACTION_METADATA["read-page"],
  run: readPageAction
})

registerAction("collect-weekly-summary", {
  ...ACTION_METADATA["collect-weekly-summary"],
  run: collectWeeklySummaryAction
})

registerAction("structured-prompt", {
  ...ACTION_METADATA["structured-prompt"],
  run: structuredPromptAction
})

registerAction("blog-prompt", {
  ...ACTION_METADATA["blog-prompt"],
  run: blogPromptAction
})

registerAction("collect-blog-digest", {
  ...ACTION_METADATA["collect-blog-digest"],
  run: collectBlogDigestAction
})

registerAction("store-artifact", {
  ...ACTION_METADATA["store-artifact"],
  run: storeArtifactAction
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

async function collectWeeklySummaryAction({ step }: ActionExecutionArgs<"collect-weekly-summary">) {
  const config = step.config ?? {}
  const days = config.days && config.days > 0 ? config.days : DEFAULT_WEEKLY_SUMMARY_DAYS
  const artifactType = config.artifactType ?? "daily-dev-recap"
  const maxEntries = Math.max(
    config.maxEntries ?? days * WEEKLY_SUMMARY_MAX_ENTRIES_MULTIPLIER,
    days
  )
  const cutoff = Date.now() - days * DAY_IN_MS

  const artifacts = await listArtifacts({
    type: artifactType,
    order: "desc",
    limit: maxEntries
  })

  const withinWindow: WeeklyRecapEntry[] = []
  let staleCount = 0

  for (const record of artifacts) {
    if (record.createdAt >= cutoff) {
      const normalized = normalizeWeeklyRecap(record)
      if (normalized) {
        withinWindow.push(normalized)
      }
    } else {
      staleCount += 1
    }
  }

  if (withinWindow.length === 0) {
    return {
      success: false as const,
      error: new Error("No daily recaps found for the selected window"),
      meta: {
        artifactType,
        days,
        staleCount,
        entryCount: 0
      }
    }
  }

  const sorted = withinWindow.sort((a, b) => a.createdAt - b.createdAt)
  const promptSections = sorted.map((entry, index) => buildWeeklyPromptSection(entry, index + 1))
  const rangeLabel = formatDateRange(sorted[0].createdAt, sorted[sorted.length - 1].createdAt)
  const promptHeader = [`Weekly recap window: ${rangeLabel}`, `Entries included: ${sorted.length}`]
  const promptInput = `${promptHeader.join("\n")}\n\n${promptSections.join("\n\n")}`

  return {
    success: true as const,
    output: promptInput,
    meta: {
      artifactType,
      days,
      staleCount,
      entryCount: sorted.length,
      rangeStart: sorted[0].dateISO,
      rangeEnd: sorted[sorted.length - 1].dateISO,
      entries: sorted.map((entry) => ({
        id: entry.id,
        date: entry.dateISO,
        summary: entry.summary,
        highlights: entry.highlights.length,
        blockers: entry.blockers.length,
        nextFocus: entry.nextFocus.length,
        actionItems: entry.actionItems.length
      }))
    }
  }
}

async function collectBlogDigestAction({ step }: ActionExecutionArgs<"collect-blog-digest">) {
  const config = step.config ?? {}
  const days = config.days && config.days > 0 ? config.days : DEFAULT_BLOG_DIGEST_DAYS
  const artifactType = config.artifactType ?? "blog-research-note"
  const maxEntries = Math.max(
    config.maxEntries ?? days * BLOG_DIGEST_MAX_ENTRIES_MULTIPLIER,
    days
  )
  const topTagsLimit =
    config.topTagsLimit && config.topTagsLimit > 0 ? config.topTagsLimit : BLOG_DIGEST_TOP_TAGS_LIMIT
  const cutoff = Date.now() - days * DAY_IN_MS

  const artifacts = await listArtifacts({
    type: artifactType,
    order: "desc",
    limit: maxEntries
  })

  const withinWindow: BlogDigestEntry[] = []
  let staleCount = 0

  for (const record of artifacts) {
    if (record.createdAt >= cutoff) {
      const normalized = normalizeBlogDigest(record)
      if (normalized) {
        withinWindow.push(normalized)
      }
    } else {
      staleCount += 1
    }
  }

  if (withinWindow.length === 0) {
    return {
      success: false as const,
      error: new Error("No blog research notes found for the selected window"),
      meta: {
        artifactType,
        days,
        staleCount,
        entryCount: 0
      }
    }
  }

  const sorted = withinWindow.sort((a, b) => a.createdAt - b.createdAt)
  const rangeLabel = formatDateRange(sorted[0].createdAt, sorted[sorted.length - 1].createdAt)
  const tagIndex = buildBlogTagIndex(sorted)
  const tagSummaries = buildTagSummaries(tagIndex).slice(0, topTagsLimit)
  const uniqueTagCount = Array.from(tagIndex.keys()).filter((tag) => tag !== "__untagged__").length
  const spotlightArticles = buildSpotlightArticles(sorted)
  const collections = buildBlogCollections(tagIndex)
  const recommendedAngles = deriveRecommendedAngles(sorted)
  const supportingLinks = collectSupportingLinks(sorted)

  const digest: BlogDigestResult = {
    summary: buildBlogDigestSummary({
      noteCount: sorted.length,
      uniqueTagCount,
      rangeLabel,
      tagSummaries
    }),
    timeframe: {
      label: rangeLabel,
      startISO: sorted[0].dateISO,
      endISO: sorted[sorted.length - 1].dateISO
    },
    totals: {
      notes: sorted.length,
      tags: uniqueTagCount,
      supportingLinks: supportingLinks.length
    },
    topTags: tagSummaries,
    spotlightArticles,
    collections,
    recommendedAngles,
    supportingLinks
  }

  const metaPayload: Record<string, unknown> = {
    artifactType,
    days,
    staleCount,
    entryCount: sorted.length,
    tagCount: uniqueTagCount,
    rangeStart: sorted[0].dateISO,
    rangeEnd: sorted[sorted.length - 1].dateISO,
    topTags: tagSummaries,
    spotlightCount: spotlightArticles.length,
    supportingLinkCount: supportingLinks.length,
    entries: sorted.map((entry) => ({
      id: entry.id,
      date: entry.dateISO,
      tags: entry.tags,
      keyInsights: entry.keyInsights.length,
      supportingLinks: entry.supportingLinks.length
    }))
  }

  const canUseViewer =
    typeof chrome !== "undefined" &&
    Boolean(chrome.runtime?.getURL) &&
    Boolean(chrome.tabs?.create)

  if (canUseViewer) {
    try {
      const viewerKey = await stashAutomationResult(digest, {
        taskId: step.id,
        taskName: step.description ?? step.type,
        stepId: step.id
      })
      metaPayload.viewerAvailable = true
      metaPayload.viewerKey = viewerKey
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      collectBlogDebug("viewer-stash-error", { message })
    }
  }

  return {
    success: true as const,
    output: digest,
    meta: metaPayload
  }
}

async function storeArtifactAction({
  input,
  step
}: ActionExecutionArgs<"store-artifact">): Promise<ActionExecutionResult<StoredArtifactRecord | undefined>> {
  const config = step.config ?? {}

  const isEmptyInput =
    input === undefined ||
    input === null ||
    (typeof input === "string" && input.trim().length === 0)

  if (config.skipWhenEmpty && isEmptyInput) {
    storeArtifactDebug("skip", { reason: "empty-input", stepId: step.id })
    return {
      success: true,
      meta: {
        skipped: true,
        reason: "empty-input"
      }
    }
  }

  if (isEmptyInput) {
    const error = new Error("store-artifact requires a non-empty input payload")
    storeArtifactDebug("input-missing", { stepId: step.id })
    return {
      success: false,
      error
    }
  }

  const payload = buildStoredPayload(input, config.parseJson ?? true, (message) => {
    storeArtifactDebug("json-parse-failed", { message })
  })
  const metadata: Record<string, unknown> = {}

  if (step.id) {
    metadata.stepId = step.id
  }
  if (step.description) {
    metadata.stepDescription = step.description
  }

  if (config.metadata) {
    Object.assign(metadata, config.metadata)
  }

  const artifactType = config.artifactType ?? "development-task"

  try {
    const record = await saveArtifact({
      type: artifactType,
      payload,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      tags: config.tags
    })

    storeArtifactDebug("saved", { artifactId: record.id, type: artifactType, hasParsed: Boolean(payload.parsed) })

    return {
      success: true,
      output: record,
      meta: {
        artifactId: record.id,
        artifactType: record.type
      }
    }
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    storeArtifactDebug("save-error", { message: normalized.message })
    return {
      success: false,
      error: normalized
    }
  }
}

async function structuredPromptAction({
  input,
  step,
  cache,
  signal
}: ActionExecutionArgs<"structured-prompt">): Promise<ActionExecutionResult<unknown>> {
  const config: StructuredPromptConfig = {
    template: step.config?.template ?? "{{input}}",
    variables: step.config?.variables,
    outputFormat: step.config?.outputFormat ?? "text",
    schema: step.config?.schema,
    usePromptApi: step.config?.usePromptApi,
    systemPrompt: step.config?.systemPrompt,
    outputLanguage: step.config?.outputLanguage,
    fallbackToTemplate: step.config?.fallbackToTemplate,
    coerceJsonOutput: step.config?.coerceJsonOutput,
    autoOpenViewer: step.config?.autoOpenViewer
  }

  const debugTrace = createDebugTrace()
  const debugLog = createScopedDebugger("automation/structured-prompt")
  const logDebug = (stage: string, details: Record<string, unknown> = {}) => {
    appendDebugTrace(debugTrace, stage, details)
    debugLog(stage, details)
  }

  const replacements = {
    input: typeof input === "string" ? input : JSON.stringify(input, null, 2),
    ...(config.variables ?? {})
  }

  const filled = renderPromptTemplate(config.template, replacements, cache)
  const fallbackOutput = formatTemplateOutput(filled, config.outputFormat)
  const shouldUsePromptApi = config.usePromptApi ?? Boolean(config.schema)
  const allowFallback = config.fallbackToTemplate ?? false
  const expectsJson = config.coerceJsonOutput ?? Boolean(config.schema || config.outputFormat === "json")
  const autoOpenViewer = config.autoOpenViewer ?? false

  const mergeMeta = (meta: Record<string, unknown>) => ({
    format: config.outputFormat,
    ...meta,
    ...(debugTrace ? { debug: debugTrace } : {})
  })

  const canUseViewer =
    typeof chrome !== "undefined" &&
    Boolean(chrome.runtime?.getURL) &&
    Boolean(chrome.tabs?.create)

  const deliverResult = async (
    rawText: string,
    meta: Record<string, unknown>
  ): Promise<ActionExecutionResult<unknown>> => {
    const normalized = expectsJson ? coerceJsonLike(rawText) : { text: rawText.trim() }
    let outputValue: unknown = normalized.parsed ?? normalized.text
    let parsedSource: string | undefined = normalized.source
    let normalizationDetails: NormalizedStructuredResult | null = null

    if (normalized.parsed !== undefined) {
      normalizationDetails = normalizeStructuredOutput(normalized.parsed, config.schema)
      outputValue = normalizationDetails.value
      if (normalizationDetails.changed) {
        parsedSource = "normalized"
      }
    }

    let viewerKey: string | undefined

    if (canUseViewer) {
      try {
        viewerKey = await stashAutomationResult(outputValue, {
          taskId: step.id,
          taskName: step.description ?? step.type,
          stepId: step.id
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logDebug("viewer-stash-error", { message })
      }

      if (viewerKey) {
        if (autoOpenViewer) {
          try {
            openStashedAutomationResult(viewerKey)
            logDebug("viewer-open", { viewerKey })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logDebug("viewer-open-error", { message })
          }
        }
      }
    }

    const serializedOutput =
      typeof outputValue === "string" ? outputValue : JSON.stringify(outputValue, null, 2)

    const metaPayload: Record<string, unknown> = {
      ...mergeMeta({
        ...meta,
        viewerAvailable: canUseViewer,
        viewerAutoOpened: autoOpenViewer && Boolean(viewerKey),
        expectsJson,
        rawLength: normalized.text.length,
        rawPreview: buildPreview(normalized.text)
      })
    }

    if (viewerKey) {
      metaPayload.viewerKey = viewerKey
    }
    if (normalized.parsed !== undefined) {
      metaPayload.parsed = true
      if (parsedSource) {
        metaPayload.parsedSource = parsedSource
      }
    } else {
      metaPayload.parsed = false
    }

    if (normalizationDetails?.changed) {
      if (normalizationDetails.modifiedFields.length > 0) {
        metaPayload.normalizedFields = normalizationDetails.modifiedFields
      }
      metaPayload.normalizedPreview = buildPreview(serializedOutput)
    }

    return {
      success: true,
      output: outputValue,
      meta: metaPayload
    }
  }

  const fallbackSuccess = (reason: string, extraMeta: Record<string, unknown> = {}) => {
    logDebug("prompt-api-fallback", { reason })
    return deliverResult(fallbackOutput, {
      usedPromptApi: false,
      fallbackUsed: true,
      fallbackReason: reason,
      ...extraMeta
    })
  }

  const failure = (error: Error, extraMeta: Record<string, unknown> = {}) => ({
    success: false,
    error,
    meta: mergeMeta({
      usedPromptApi: true,
      ...extraMeta
    })
  })

  logDebug("start", {
    hasSchema: Boolean(config.schema),
    usePromptApi: shouldUsePromptApi,
    templateLength: config.template.length,
    replacementKeys: Object.keys(replacements)
  })

  if (!shouldUsePromptApi) {
    logDebug("prompt-api-skip", { reason: "disabled" })
    return deliverResult(fallbackOutput, {
      usedPromptApi: false
    })
  }

  const languageModel = resolveLanguageModelNamespace()
  if (!languageModel?.create) {
    logDebug("prompt-api-missing", { reason: "namespace-missing" })
    const error = new Error("Chrome Prompt API is not available in this context")
    if (allowFallback) {
      return fallbackSuccess("namespace-missing", { availability: "missing" })
    }
    return failure(error, { availability: "missing" })
  }

  const modelOptions: Record<string, unknown> = {
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: [config.outputLanguage ?? "en"] }]
  }

  let availability: string | undefined
  if (languageModel.availability) {
    try {
      availability = await languageModel.availability(modelOptions)
      logDebug("availability", { state: availability })
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      logDebug("availability-error", { message: normalized.message })
      if (allowFallback) {
        return fallbackSuccess("availability-error", { availability: "error" })
      }
      return failure(normalized, { availability: "error" })
    }
  }

  if (availability === "unavailable") {
    const error = new Error("Chrome Prompt API is unavailable on this device")
    if (allowFallback) {
      return fallbackSuccess("availability-unavailable", { availability })
    }
    return failure(error, { availability })
  }

  const requiresDownload = availability === "downloadable" || availability === "downloading"
  const isActivated =
    typeof navigator !== "undefined" && "userActivation" in navigator
      ? (navigator as Navigator & { userActivation: { isActive: boolean } }).userActivation
          .isActive
      : true

  if (requiresDownload && !isActivated) {
    const error = new Error("Prompt API session requires a user interaction before model download")
    if (allowFallback) {
      return fallbackSuccess("user-activation", {
        availability,
        needsUserActivation: true
      })
    }
    return failure(error, {
      availability,
      needsUserActivation: true
    })
  }

  let session: PromptApiSession
  try {
    session = await languageModel.create({
      ...modelOptions,
      signal
    })
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    logDebug("session-create-error", { message: normalized.message })
    if (allowFallback) {
      return fallbackSuccess("session-create-error", { availability })
    }
    return failure(normalized, { availability })
  }

  try {
    const payload = buildPromptPayload(filled, config.systemPrompt)
    const options: Record<string, unknown> = {}
    if (config.schema) {
      options.responseConstraint = config.schema
    }
    if (signal) {
      options.signal = signal
    }

    logDebug("prompt-run", {
      payloadType: Array.isArray(payload) ? "messages" : "string",
      hasSchema: Boolean(config.schema)
    })

    const result = await session.prompt(payload, options)
    const resultText = typeof result === "string" ? result : String(result)
    return deliverResult(resultText, {
      usedPromptApi: true,
      availability,
      promptLength: filled.length,
      resultLength: resultText.length,
      schemaProvided: Boolean(config.schema)
    })
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    logDebug("prompt-error", { message: normalized.message })
    if (allowFallback) {
      return fallbackSuccess("prompt-error", { availability })
    }
    return failure(normalized, { availability })
  } finally {
    try {
      session.destroy?.()
    } catch (destroyError) {
      const normalized = destroyError instanceof Error ? destroyError : new Error(String(destroyError))
      logDebug("session-destroy-error", { message: normalized.message })
    }
  }
}

async function blogPromptAction(
  args: ActionExecutionArgs<"blog-prompt">
): Promise<ActionExecutionResult<unknown>> {
  const baseConfig: BlogPromptConfig = args.step.config ?? ({} as BlogPromptConfig)
  const overriddenVariables = baseConfig.variables ?? {}
  const formatVersion = overriddenVariables.formatVersion ?? BLOG_PROMPT_DEFAULT_FORMAT
  const variables = {
    ...overriddenVariables,
    formatVersion
  }

  const mergedConfig: StructuredPromptConfig = {
    ...baseConfig,
    template: baseConfig.template ?? BLOG_PROMPT_DEFAULT_TEMPLATE,
    schema: baseConfig.schema ?? BLOG_PROMPT_DEFAULT_SCHEMA,
    variables,
    outputFormat: baseConfig.outputFormat ?? "text",
    coerceJsonOutput: baseConfig.coerceJsonOutput ?? true,
    fallbackToTemplate: baseConfig.fallbackToTemplate ?? true,
    usePromptApi: baseConfig.usePromptApi ?? true,
    autoOpenViewer: baseConfig.autoOpenViewer ?? false
  }

  const structuredArgs = {
    ...args,
    step: {
      ...args.step,
      type: "structured-prompt" as const,
      config: mergedConfig
    }
  } satisfies ActionExecutionArgs<"structured-prompt">

  const result = await structuredPromptAction(structuredArgs)

  if (!result.meta) {
    return result
  }

  return {
    ...result,
    meta: {
      ...result.meta,
      blogPrompt: true,
      blogSchemaVersion: formatVersion
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
