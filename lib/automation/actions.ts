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
import { openStashedAutomationResult, stashAutomationResult } from "../viewer"
import {
  saveArtifact,
  type StoredArtifactPayload,
  type StoredArtifactRecord
} from "../storage"

const registry = new Map<ActionType, RegisteredAction<ActionType>>()
const storeArtifactDebug = createScopedDebugger("automation/store-artifact")

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

const KNOWN_STRING_FIELDS = new Set(["summary"])
const KNOWN_STRING_ARRAY_FIELDS = new Set([
  "highlights",
  "blockers",
  "nextFocus",
  "actionItems",
  "suggestedClarifications",
  "testPlan"
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
      const textKeys = ["text", "title", "label", "name", "summary", "description", "value"]
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
