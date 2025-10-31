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
import {
  listArtifacts,
  saveArtifact,
  type StoredArtifactPayload,
  type StoredArtifactRecord
} from "../storage"

const registry = new Map<ActionType, RegisteredAction<ActionType>>()
const storeArtifactDebug = createScopedDebugger("automation/store-artifact")
const collectBlogDebug = createScopedDebugger("automation/collect-blog-digest")

const BLOG_PROMPT_DEFAULT_FORMAT = "blog-v3"

const BLOG_PROMPT_DEFAULT_TEMPLATE = `Format version: {{formatVersion}}
You are compiling research notes for a future blog post. Study only the supplied page content and distill it into the JSON schema below. The response MUST be valid JSON with no commentary and no markdown code fences.

Schema fields:
- summary: string (2-3 sentences capturing the page's core idea)
- tags: array of string (2-3 concise, lowercase slugs that cluster the topic)
- keyInsights: array of string (max 6, succinct takeaways)
- technicalHighlights: array of string (max 6, noteworthy technologies, APIs, or data points)
- narrativeDirections: array of string (max 4, suggested angles or outlines for the post)
- supportingLinks: array of string (max 4, absolute URLs worth revisiting)
- sourceUrl: string (the canonical URL for the captured page, empty string when unavailable)

Rules:
1. Emit only the JSON object with the schema above.
2. Trim whitespace, remove numbering or bullet prefixes, and deduplicate entries.
3. Use [] for empty lists and an empty string when information is missing.
4. For tags, cite 2-3 short identifiers that would help group this article with similar themes (use hyphenated slugs when possible).
5. If the provided content includes a line beginning with "URL:", reuse that value for sourceUrl.
6. Preserve factual accuracy—do not invent details beyond the source content.

Page content:
{{input}}`

const BLOG_PROMPT_DEFAULT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: { type: "string" },
    tags: {
      type: "array",
      items: { type: "string" },
      minItems: 2,
      maxItems: 3
    },
    keyInsights: {
      type: "array",
      items: { type: "string" },
      maxItems: 6
    },
    technicalHighlights: {
      type: "array",
      items: { type: "string" },
      maxItems: 6
    },
    narrativeDirections: {
      type: "array",
      items: { type: "string" },
      maxItems: 4
    },
    supportingLinks: {
      type: "array",
      items: { type: "string" },
      maxItems: 4
    },
    sourceUrl: { type: "string" }
  },
  required: ["summary", "tags", "keyInsights", "sourceUrl"],
  additionalProperties: false
}

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

registerAction("collect-weekly-summary", {
  name: "Collect weekly recaps",
  description: "Gather stored daily recaps for weekly reporting",
  run: collectWeeklySummaryAction
})

registerAction("structured-prompt", {
  name: "Prompt template",
  description: "Render a prompt template with contextual values",
  run: structuredPromptAction
})

registerAction("blog-prompt", {
  name: "Blog prompt",
  description: "Extract blog-ready research notes from captured content",
  run: blogPromptAction
})

registerAction("collect-blog-digest", {
  name: "Collect blog research",
  description: "Gather stored blog research notes for weekly synthesis",
  run: collectBlogDigestAction
})

registerAction("store-artifact", {
  name: "Store artifact",
  description: "Persist automation output for future recall",
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

const DAY_IN_MS = 86_400_000

type WeeklyRecapEntry = {
  id: string
  createdAt: number
  dateISO: string
  dateLabel: string
  summary: string
  highlights: string[]
  blockers: string[]
  nextFocus: string[]
  actionItems: string[]
}

async function collectWeeklySummaryAction({ step }: ActionExecutionArgs<"collect-weekly-summary">) {
  const config = step.config ?? {}
  const days = config.days && config.days > 0 ? config.days : 7
  const artifactType = config.artifactType ?? "daily-dev-recap"
  const maxEntries = Math.max(config.maxEntries ?? days * 3, days)
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

type BlogDigestEntry = {
  id: string
  createdAt: number
  dateISO: string
  dateLabel: string
  summary: string
  tags: string[]
  keyInsights: string[]
  technicalHighlights: string[]
  narrativeDirections: string[]
  supportingLinks: string[]
  sourceUrl?: string
}

type BlogTagSummary = {
  tag: string
  count: number
}

type BlogDigestResult = {
  summary: string
  timeframe: {
    label: string
    startISO: string
    endISO: string
  }
  totals: {
    notes: number
    tags: number
    supportingLinks: number
  }
  topTags: BlogTagSummary[]
  spotlightArticles: Array<{
    id: string
    date?: string
    summary: string
    tags: string[]
    keyInsights: string[]
    technicalHighlights: string[]
    supportingLinks: string[]
    sourceUrl?: string
  }>
  collections: Array<{
    tag: string
    synopsis: string
    entries: Array<{
      id: string
      summary: string
      keyInsights: string[]
      supportingLinks: string[]
      dateLabel?: string
    }>
  }>
  recommendedAngles: string[]
  supportingLinks: string[]
}

async function collectBlogDigestAction({ step }: ActionExecutionArgs<"collect-blog-digest">) {
  const config = step.config ?? {}
  const days = config.days && config.days > 0 ? config.days : 7
  const artifactType = config.artifactType ?? "blog-research-note"
  const maxEntries = Math.max(config.maxEntries ?? days * 6, days)
  const topTagsLimit = config.topTagsLimit && config.topTagsLimit > 0 ? config.topTagsLimit : 6
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

  const payload = buildStoredPayload(input, config.parseJson ?? true)
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

function buildStoredPayload(rawInput: unknown, shouldParse: boolean): StoredArtifactPayload {
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim()
    return {
      raw: rawInput,
      parsed: shouldParse ? tryParseJson(trimmed) : undefined
    }
  }

  return {
    raw: JSON.stringify(rawInput, null, 2),
    parsed: rawInput
  }
}

function tryParseJson(value: string) {
  if (!value) {
    return undefined
  }

  try {
    return JSON.parse(value)
  } catch (error) {
    storeArtifactDebug("json-parse-failed", { message: error instanceof Error ? error.message : String(error) })
    return undefined
  }
}

type PromptApiNamespace = {
  availability?: (options?: Record<string, unknown>) => Promise<string>
  create?: (options?: Record<string, unknown>) => Promise<PromptApiSession>
  params?: () => Promise<Record<string, unknown>>
}

type PromptApiSession = {
  prompt: (input: unknown, options?: Record<string, unknown>) => Promise<string>
  promptStreaming?: (input: unknown, options?: Record<string, unknown>) => AsyncIterable<string>
  destroy?: () => void
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

function renderPromptTemplate(
  template: string,
  replacements: Record<string, unknown>,
  cache: Map<string, unknown>
) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, key: string) => {
    if (Object.prototype.hasOwnProperty.call(replacements, key)) {
      return String(replacements[key])
    }

    if (cache.has(key)) {
      const value = cache.get(key)
      return typeof value === "string" ? value : JSON.stringify(value)
    }

    return `{{${key}}}`
  })
}

type CoercedJsonResult = {
  text: string
  parsed?: unknown
  source?: "direct" | "fenced" | "balanced" | "trimmed"
}

type NormalizedStructuredResult = {
  value: unknown
  changed: boolean
  modifiedFields: string[]
}

type JsonSchema = {
  type?: string | string[]
  properties?: Record<string, unknown>
  items?: JsonSchema | JsonSchema[]
}

type SchemaHints = {
  stringProps: Set<string>
  stringArrayProps: Set<string>
}

const KNOWN_STRING_FIELDS = new Set(["summary", "sourceUrl"])
const KNOWN_STRING_ARRAY_FIELDS = new Set([
  "highlights",
  "blockers",
  "nextFocus",
  "actionItems",
  "suggestedClarifications",
  "testPlan",
  "tags",
  "keyInsights",
  "technicalHighlights",
  "narrativeDirections",
  "supportingLinks"
])

function coerceJsonLike(rawValue: string): CoercedJsonResult {
  const trimmed = rawValue.trim()
  const candidates: Array<{ value: string; source: CoercedJsonResult["source"] }> = []

  if (trimmed) {
    candidates.push({ value: trimmed, source: "direct" })
  }

  const fenced = stripCodeFence(trimmed)
  if (fenced && fenced !== trimmed) {
    candidates.push({ value: fenced, source: "fenced" })
  }

  const balanced = extractBalancedJson(trimmed)
  if (balanced && balanced !== trimmed) {
    candidates.push({ value: balanced, source: "balanced" })
  }

  for (const candidate of candidates) {
    const parsed = tryParseCandidate(candidate.value)
    if (parsed.success) {
      return {
        text: parsed.text,
        parsed: parsed.value,
        source: candidate.source
      }
    }
  }

  return {
    text: trimmed,
    source: "trimmed"
  }
}

function normalizeStructuredOutput(
  value: unknown,
  schema?: Record<string, unknown>
): NormalizedStructuredResult {
  if (!isPlainRecord(value)) {
    return { value, changed: false, modifiedFields: [] }
  }

  const hints = extractSchemaHints(schema)
  KNOWN_STRING_FIELDS.forEach((field) => hints.stringProps.add(field))
  KNOWN_STRING_ARRAY_FIELDS.forEach((field) => hints.stringArrayProps.add(field))

  const working: Record<string, unknown> = { ...value }
  const modified = new Set<string>()
  let changed = false

  for (const key of hints.stringArrayProps) {
    if (!Object.prototype.hasOwnProperty.call(working, key)) {
      continue
    }

    const current = working[key]
    const { value: coerced, changed: fieldChanged } = coerceStringArrayField(current)
    if (fieldChanged) {
      changed = true
      modified.add(key)
    }
    working[key] = coerced
  }

  for (const key of hints.stringProps) {
    if (!Object.prototype.hasOwnProperty.call(working, key)) {
      continue
    }

    const current = working[key]
    const { value: coerced, changed: fieldChanged } = coerceStringField(current)
    if (fieldChanged) {
      changed = true
      modified.add(key)
    }
    working[key] = coerced
  }

  if (Object.prototype.hasOwnProperty.call(working, "draftPullRequest")) {
    const draft = normalizeDraftPullRequest(working.draftPullRequest)
    if (draft.changed) {
      changed = true
      draft.modifiedFields.forEach((field) => modified.add(field))
    }
    working.draftPullRequest = draft.value
  }

  if (Object.prototype.hasOwnProperty.call(working, "draftSections")) {
    const sections = normalizeDraftSections(working.draftSections)
    if (sections.changed) {
      changed = true
      sections.modifiedFields.forEach((field) => modified.add(field))
    }
    working.draftSections = sections.value
  }

  if (!changed) {
    return { value, changed: false, modifiedFields: [] }
  }

  return { value: working, changed: true, modifiedFields: Array.from(modified) }
}

function extractSchemaHints(schema?: Record<string, unknown>): SchemaHints {
  const hints: SchemaHints = {
    stringProps: new Set<string>(),
    stringArrayProps: new Set<string>()
  }

  if (!isPlainRecord(schema)) {
    return hints
  }

  const properties = (schema.properties ?? {}) as Record<string, unknown>
  for (const [key, descriptor] of Object.entries(properties)) {
    if (!isPlainRecord(descriptor)) {
      continue
    }

    const typedDescriptor = descriptor as JsonSchema
    const types = normalizeSchemaType(typedDescriptor.type)

    if (types.includes("string")) {
      hints.stringProps.add(key)
    }

    if (types.includes("array") && schemaHasStringItems(typedDescriptor.items)) {
      hints.stringArrayProps.add(key)
    }
  }

  return hints
}

function schemaHasStringItems(items: JsonSchema | JsonSchema[] | undefined) {
  if (!items) {
    return false
  }

  if (Array.isArray(items)) {
    return items.some((entry) => normalizeSchemaType(entry?.type).includes("string"))
  }

  return normalizeSchemaType(items.type).includes("string")
}

function normalizeSchemaType(type: JsonSchema["type"]) {
  if (typeof type === "string") {
    return [type]
  }
  if (Array.isArray(type)) {
    return type.filter((entry): entry is string => typeof entry === "string")
  }
  return []
}

function coerceStringArrayField(value: unknown): { value: string[]; changed: boolean } {
  if (value === undefined || value === null) {
    return { value: [], changed: true }
  }

  const flattened = flattenStringList(value)
  const unchanged = arraysShallowEqual(value, flattened)
  return { value: flattened, changed: !unchanged }
}

function coerceStringField(value: unknown): { value: string; changed: boolean } {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return { value: trimmed, changed: trimmed !== value }
  }

  if (value === undefined || value === null) {
    return { value: "", changed: true }
  }

  const flattened = flattenStringList(value)
  if (flattened.length === 0) {
    return { value: "", changed: true }
  }

  return { value: flattened.join("\n"), changed: true }
}

function flattenStringList(value: unknown): string[] {
  const result: string[] = []
  const seen = new Set<string>()

  const push = (entry: string) => {
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) {
      return
    }
    seen.add(trimmed)
    result.push(trimmed)
  }

  const visit = (entry: unknown) => {
    if (entry === undefined || entry === null) {
      return
    }

    if (typeof entry === "string") {
      const pieces = entry
        .split(/\r?\n+/)
        .map((part) => part.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
        .filter(Boolean)
      if (pieces.length === 0) {
        return
      }
      pieces.forEach(push)
      return
    }

    if (typeof entry === "number" || typeof entry === "boolean") {
      push(String(entry))
      return
    }

    if (Array.isArray(entry)) {
      entry.forEach(visit)
      return
    }

    if (isPlainRecord(entry)) {
      const record = entry as Record<string, unknown>
      const textKeys = [
        "text",
        "title",
        "label",
        "name",
        "summary",
        "description",
        "value",
        "url",
        "slug",
        "quote"
      ]
      const collected = textKeys
        .map((key) => (typeof record[key] === "string" ? (record[key] as string) : null))
        .filter((segment): segment is string => Boolean(segment))

      if (collected.length > 0) {
        visit(collected.join(": "))
        return
      }

      try {
        push(JSON.stringify(entry))
      } catch {
        // noop
      }
      return
    }

    try {
      push(String(entry))
    } catch {
      // noop
    }
  }

  visit(value)
  return result
}

function arraysShallowEqual(source: unknown, target: string[]) {
  if (source === undefined || source === null) {
    return target.length === 0
  }

  if (!Array.isArray(source)) {
    return false
  }

  if (source.length !== target.length) {
    return false
  }

  for (let index = 0; index < source.length; index += 1) {
    const entry = source[index]
    if (typeof entry !== "string") {
      return false
    }
    if (entry.trim() !== target[index]) {
      return false
    }
  }

  return true
}

type NormalizedDraft = {
  value: {
    title: string
    content: string
    potentialRegressions: string[]
    blastRadius: string
  }
  changed: boolean
  modifiedFields: string[]
}

function normalizeDraftPullRequest(value: unknown): NormalizedDraft {
  const allowedKeys = new Set(["title", "content", "potentialRegressions", "blastRadius"])
  const result: NormalizedDraft = {
    value: {
      title: "",
      content: "",
      potentialRegressions: [],
      blastRadius: ""
    },
    changed: false,
    modifiedFields: []
  }

  if (!isPlainRecord(value)) {
    result.changed = true
    result.modifiedFields.push("draftPullRequest")
    return result
  }

  const working: Record<string, unknown> = { ...value }

  for (const key of Object.keys(working)) {
    if (!allowedKeys.has(key)) {
      delete working[key]
      result.changed = true
      result.modifiedFields.push(`draftPullRequest.${key}`)
    }
  }

  const title = coerceStringField(working.title)
  if (title.changed || title.value !== working.title) {
    result.changed = true
    result.modifiedFields.push("draftPullRequest.title")
  }
  result.value.title = title.value

  const content = coerceStringField(working.content)
  if (content.changed || content.value !== working.content) {
    result.changed = true
    result.modifiedFields.push("draftPullRequest.content")
  }
  result.value.content = content.value

  const regressions = coerceStringArrayField(working.potentialRegressions)
  let normalizedRegressions = regressions.value
  if (normalizedRegressions.length > 5) {
    normalizedRegressions = normalizedRegressions.slice(0, 5)
  }
  if (regressions.changed || !arraysShallowEqual(working.potentialRegressions, normalizedRegressions)) {
    result.changed = true
    result.modifiedFields.push("draftPullRequest.potentialRegressions")
  }
  result.value.potentialRegressions = normalizedRegressions

  const blastRadius = coerceStringField(working.blastRadius)
  if (blastRadius.changed || blastRadius.value !== working.blastRadius) {
    result.changed = true
    result.modifiedFields.push("draftPullRequest.blastRadius")
  }
  result.value.blastRadius = blastRadius.value

  if (!result.changed) {
    return {
      value: {
        title: title.value,
        content: content.value,
        potentialRegressions: normalizedRegressions,
        blastRadius: blastRadius.value
      },
      changed: false,
      modifiedFields: []
    }
  }

  result.modifiedFields = Array.from(new Set(result.modifiedFields))
  return result
}

type DraftSection = {
  heading: string
  bullets: string[]
}

type NormalizedDraftSections = {
  value: DraftSection[]
  changed: boolean
  modifiedFields: string[]
}

const MAX_DRAFT_SECTION_COUNT = 6
const MAX_DRAFT_SECTION_BULLETS = 8

function normalizeDraftSections(value: unknown): NormalizedDraftSections {
  const modified = new Set<string>()
  let changed = false

  const rawEntries = Array.isArray(value) ? value : []
  if (!Array.isArray(value)) {
    changed = true
    modified.add("draftSections")
  }

  const normalized: DraftSection[] = []

  const pushSection = (section: DraftSection) => {
    normalized.push(section)
    if (normalized.length > MAX_DRAFT_SECTION_COUNT) {
      normalized.length = MAX_DRAFT_SECTION_COUNT
      modified.add("draftSections.length")
      changed = true
    }
  }

  for (const entry of rawEntries) {
    if (normalized.length >= MAX_DRAFT_SECTION_COUNT) {
      break
    }

    if (!isPlainRecord(entry)) {
      if (typeof entry === "string") {
        const trimmed = entry.trim()
        if (trimmed) {
          pushSection({ heading: trimmed, bullets: [] })
          modified.add("draftSections.heading")
          changed = true
        } else {
          changed = true
        }
      } else if (entry != null) {
        changed = true
        modified.add("draftSections")
      }
      continue
    }

    const working = entry as Record<string, unknown>
    const headingResult = coerceStringField(working.heading)
    let bulletsResult = coerceStringArrayField(working.bullets)
    let bullets = bulletsResult.value

    if (bullets.length > MAX_DRAFT_SECTION_BULLETS) {
      bullets = bullets.slice(0, MAX_DRAFT_SECTION_BULLETS)
      bulletsResult = { value: bullets, changed: true }
    }

    const heading = headingResult.value
    const hasContent = Boolean(heading) || bullets.length > 0

    if (!hasContent) {
      if (headingResult.changed || bulletsResult.changed) {
        changed = true
        modified.add("draftSections")
      }
      continue
    }

    if (
      headingResult.changed ||
      typeof working.heading !== "string" ||
      (typeof working.heading === "string" && working.heading.trim() !== heading)
    ) {
      modified.add("draftSections.heading")
      changed = true
    }

    if (
      bulletsResult.changed ||
      !Array.isArray(working.bullets) ||
      !arraysShallowEqual(working.bullets, bullets)
    ) {
      modified.add("draftSections.bullets")
      changed = true
    }

    pushSection({ heading, bullets })
  }

  return {
    value: normalized,
    changed,
    modifiedFields: Array.from(modified)
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stripCodeFence(value: string) {
  if (!value.startsWith("```")) {
    return value
  }

  const firstBreak = value.indexOf("\n")
  if (firstBreak === -1) {
    return value
  }

  const closingFence = value.lastIndexOf("```")
  if (closingFence <= firstBreak) {
    return value
  }

  const inner = value.slice(firstBreak + 1, closingFence).trim()
  return inner.length > 0 ? inner : value
}

function extractBalancedJson(value: string) {
  const braceStart = value.indexOf("{")
  const braceEnd = value.lastIndexOf("}")
  if (braceStart !== -1 && braceEnd > braceStart) {
    return value.slice(braceStart, braceEnd + 1)
  }

  const bracketStart = value.indexOf("[")
  const bracketEnd = value.lastIndexOf("]")
  if (bracketStart !== -1 && bracketEnd > bracketStart) {
    return value.slice(bracketStart, bracketEnd + 1)
  }

  return value
}

function tryParseCandidate(candidate: string) {
  const attempts = [candidate, candidate.endsWith(";") ? candidate.slice(0, -1) : null].filter(
    (entry): entry is string => Boolean(entry)
  )

  for (const attempt of attempts) {
    try {
      return { success: true as const, value: JSON.parse(attempt), text: attempt }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/Unexpected token ['"`]/i.test(message)) {
        continue
      }
    }
  }

  return { success: false as const, text: candidate }
}

function buildPreview(value: string, limit = 360) {
  const trimmed = value.trim()
  if (trimmed.length <= limit) {
    return trimmed
  }
  return `${trimmed.slice(0, limit)}…`
}

function normalizeWeeklyRecap(record: StoredArtifactRecord): WeeklyRecapEntry | null {
  const parsed = resolveRecapPayload(record.payload)

  const summary = typeof parsed?.summary === "string" ? parsed.summary.trim() : ""
  const highlights = ensureStringList(parsed?.highlights)
  const blockers = ensureStringList(parsed?.blockers)
  const nextFocus = ensureStringList(parsed?.nextFocus)
  const actionItems = ensureStringList(parsed?.actionItems)

  const fallbackSummary = summary || highlights[0] || nextFocus[0] || blockers[0] || actionItems[0] || ""
  const date = new Date(record.createdAt)

  return {
    id: record.id,
    createdAt: record.createdAt,
    dateISO: date.toISOString(),
    dateLabel: formatDateLabel(date),
    summary: fallbackSummary,
    highlights,
    blockers,
    nextFocus,
    actionItems
  }
}

function normalizeBlogDigest(record: StoredArtifactRecord): BlogDigestEntry | null {
  const parsed = resolveRecapPayload(record.payload)
  if (!parsed) {
    return null
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : ""
  const tags = ensureStringList(parsed.tags)
  const keyInsights = ensureStringList(parsed.keyInsights)
  const technicalHighlights = ensureStringList(parsed.technicalHighlights)
  const narrativeDirections = ensureStringList(parsed.narrativeDirections)
  const supportingLinks = ensureStringList(parsed.supportingLinks)
  const sourceUrl = typeof parsed.sourceUrl === "string" ? parsed.sourceUrl.trim() : ""
  const date = new Date(record.createdAt)

  return {
    id: record.id,
    createdAt: record.createdAt,
    dateISO: date.toISOString(),
    dateLabel: formatDateLabel(date),
    summary,
    tags,
    keyInsights,
    technicalHighlights,
    narrativeDirections,
    supportingLinks,
    sourceUrl: sourceUrl || undefined
  }
}

function resolveRecapPayload(payload: StoredArtifactPayload) {
  if (payload.parsed && typeof payload.parsed === "object") {
    return payload.parsed as Record<string, unknown>
  }

  try {
    return JSON.parse(payload.raw) as Record<string, unknown>
  } catch (_error) {
    return null
  }
}

function ensureStringList(value: unknown) {
  if (!value) {
    return [] as string[]
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? String(item).trim() : null))
      .filter((item): item is string => Boolean(item))
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((item) => (typeof item === "string" ? item.trim() : null))
      .filter((item): item is string => Boolean(item))
  }

  return [] as string[]
}

function buildBlogTagIndex(entries: BlogDigestEntry[]) {
  const map = new Map<string, BlogDigestEntry[]>()

  const push = (tag: string, entry: BlogDigestEntry) => {
    const current = map.get(tag)
    if (current) {
      current.push(entry)
    } else {
      map.set(tag, [entry])
    }
  }

  for (const entry of entries) {
    if (entry.tags.length === 0) {
      push("__untagged__", entry)
      continue
    }
    entry.tags.forEach((tag) => push(tag, entry))
  }

  for (const [, list] of map) {
    list.sort((a, b) => a.createdAt - b.createdAt)
  }

  return map
}

function buildTagSummaries(index: Map<string, BlogDigestEntry[]>) {
  const summaries: BlogTagSummary[] = []
  for (const [tag, entries] of index.entries()) {
    if (tag === "__untagged__") {
      continue
    }
    summaries.push({ tag, count: entries.length })
  }

  return summaries.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

function formatDateLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date)
}

function formatDateRange(start: number, end: number) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  })
  const startText = formatter.format(new Date(start))
  const endText = formatter.format(new Date(end))
  return startText === endText ? startText : `${startText} – ${endText}`
}

function buildWeeklyPromptSection(entry: WeeklyRecapEntry, index: number) {
  const highlights = entry.highlights.length
    ? entry.highlights.map((item) => `- ${item}`).join("\n")
    : "- None"
  const blockers = entry.blockers.length
    ? entry.blockers.map((item) => `- ${item}`).join("\n")
    : "- None"
  const nextFocus = entry.nextFocus.length
    ? entry.nextFocus.map((item) => `- ${item}`).join("\n")
    : "- None"
  const actionItems = entry.actionItems.length
    ? entry.actionItems.map((item) => `- ${item}`).join("\n")
    : "- None"

  return [
    `Entry ${index}: ${entry.dateLabel}`,
    `Summary: ${entry.summary || "None"}`,
    `Highlights:\n${highlights}`,
    `Blockers:\n${blockers}`,
    `Next focus:\n${nextFocus}`,
    `Action items:\n${actionItems}`
  ].join("\n")
}

function buildBlogDigestSummary({
  noteCount,
  uniqueTagCount,
  rangeLabel,
  tagSummaries
}: {
  noteCount: number
  uniqueTagCount: number
  rangeLabel: string
  tagSummaries: BlogTagSummary[]
}) {
  const noteLabel = noteCount === 1 ? "note" : "notes"
  const tagLabel = uniqueTagCount === 1 ? "tag" : "tags"
  const intro = `Captured ${noteCount} research ${noteLabel} across ${uniqueTagCount} ${tagLabel} over ${rangeLabel}.`

  if (tagSummaries.length === 0) {
    return intro
  }

  const topThemes = tagSummaries
    .slice(0, Math.min(3, tagSummaries.length))
    .map((entry) => `${entry.tag} (${entry.count})`)
    .join(", ")

  return `${intro} Top themes: ${topThemes}.`
}

function buildSpotlightArticles(entries: BlogDigestEntry[], limit = 3) {
  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt)
  return sorted.slice(0, limit).map((entry) => {
    const summary = entry.summary || entry.keyInsights[0] || entry.narrativeDirections[0] || "Untitled insight"
    return {
      id: entry.id,
      date: entry.dateLabel,
      summary,
      tags: entry.tags.slice(0, 4),
      keyInsights: entry.keyInsights.slice(0, 4),
      technicalHighlights: entry.technicalHighlights.slice(0, 4),
      supportingLinks: collectLinksFromEntry(entry).slice(0, 3),
      sourceUrl: entry.sourceUrl
    }
  })
}

function buildBlogCollections(
  index: Map<string, BlogDigestEntry[]>,
  limit = 6,
  entriesPerTag = 6
) {
  const collections: Array<{
    tag: string
    synopsis: string
    entries: Array<{
      id: string
      summary: string
      keyInsights: string[]
      supportingLinks: string[]
      dateLabel?: string
    }>
  }> = []

  for (const [tag, tagEntries] of index.entries()) {
    if (tag === "__untagged__") {
      continue
    }

    const entries = tagEntries.slice(-entriesPerTag)
    if (entries.length === 0) {
      continue
    }

    const latest = entries[entries.length - 1]
    const notableInsight = entries.find((entry) => entry.keyInsights.length)?.keyInsights[0]
    const synopsisParts = [`${tagEntries.length} ${tagEntries.length === 1 ? "note" : "notes"} captured`]

    if (latest) {
      const highlight = latest.summary || latest.keyInsights[0] || latest.narrativeDirections[0]
      if (highlight) {
        synopsisParts.push(`Latest: ${highlight}`)
      }
    }

    if (notableInsight) {
      synopsisParts.push(`Key insight: ${notableInsight}`)
    }

    const normalizedEntries = entries.map((entry) => ({
      id: entry.id,
      summary: entry.summary || entry.keyInsights[0] || entry.narrativeDirections[0] || "Note highlight",
      keyInsights: entry.keyInsights.slice(0, 4),
      supportingLinks: collectLinksFromEntry(entry).slice(0, 3),
      dateLabel: entry.dateLabel
    }))

    collections.push({
      tag,
      synopsis: synopsisParts.join(" · "),
      entries: normalizedEntries
    })
  }

  return collections.slice(0, limit)
}

function deriveRecommendedAngles(entries: BlogDigestEntry[], limit = 6) {
  return collectUniqueStrings(entries.flatMap((entry) => entry.narrativeDirections ?? []), limit)
}

function collectSupportingLinks(entries: BlogDigestEntry[], limit = 12) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const entry of entries.slice().sort((a, b) => b.createdAt - a.createdAt)) {
    for (const link of collectLinksFromEntry(entry)) {
      if (!seen.has(link)) {
        seen.add(link)
        result.push(link)
        if (result.length >= limit) {
          return result
        }
      }
    }
  }

  return result
}

function collectLinksFromEntry(entry: BlogDigestEntry) {
  const seen = new Set<string>()
  const links: string[] = []
  const push = (value?: string) => {
    if (!value) {
      return
    }
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) {
      return
    }
    seen.add(trimmed)
    links.push(trimmed)
  }

  entry.supportingLinks.forEach(push)
  push(entry.sourceUrl)
  return links
}

function collectUniqueStrings(values: Iterable<string>, limit?: number) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    if (!value) {
      continue
    }
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    result.push(trimmed)
    seen.add(trimmed)
    if (limit && result.length >= limit) {
      break
    }
  }

  return result
}

function formatTemplateOutput(
  filled: string,
  format: StructuredPromptConfig["outputFormat"] = "text"
) {
  if (format === "json") {
    return JSON.stringify({ prompt: filled }, null, 2)
  }

  if (format === "markdown") {
    return `### Prompt\n\n${filled}`
  }

  return filled
}

function buildPromptPayload(filled: string, systemPrompt?: string) {
  if (!systemPrompt) {
    return filled
  }

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: filled }
  ]
}

function resolveLanguageModelNamespace(): PromptApiNamespace | undefined {
  const globalAny = globalThis as unknown as Record<string, unknown>

  const direct = globalAny.LanguageModel
  if (direct && (typeof direct === "object" || typeof direct === "function")) {
    return direct as PromptApiNamespace
  }

  const ai = (globalAny.ai ?? {}) as Record<string, unknown>
  const fromAi = ai.languageModel
  if (fromAi && (typeof fromAi === "object" || typeof fromAi === "function")) {
    return fromAi as PromptApiNamespace
  }

  return undefined
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
