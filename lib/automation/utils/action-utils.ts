import type {
  BlogDigestEntry,
  BlogTagSummary,
  CoercedJsonResult,
  DraftSection,
  NormalizedDraft,
  NormalizedDraftSections,
  NormalizedStructuredResult,
  PromptApiNamespace,
  WeeklyRecapEntry
} from "../action-types"
import {
  DEFAULT_COLLECTION_ENTRIES_PER_TAG,
  DEFAULT_COLLECTION_LIMIT,
  DEFAULT_RECOMMENDED_ANGLES_LIMIT,
  DEFAULT_SPOTLIGHT_ARTICLE_LIMIT,
  DEFAULT_SUPPORTING_LINKS_LIMIT,
  KNOWN_STRING_ARRAY_FIELDS,
  KNOWN_STRING_FIELDS,
  MAX_DRAFT_SECTION_BULLETS,
  MAX_DRAFT_SECTION_COUNT
} from "../config/action-config"
import type { StructuredPromptConfig } from "../types"
import type { StoredArtifactPayload, StoredArtifactRecord } from "../../storage"

type JsonSchema = {
  type?: string | string[]
  properties?: Record<string, unknown>
  items?: JsonSchema | JsonSchema[]
}

type SchemaHints = {
  stringProps: Set<string>
  stringArrayProps: Set<string>
}

const STRING_FIELD_SET = new Set<string>(KNOWN_STRING_FIELDS)
const STRING_ARRAY_FIELD_SET = new Set<string>(KNOWN_STRING_ARRAY_FIELDS)

export function renderPromptTemplate(
  template: string,
  replacements: Record<string, unknown>,
  cache: Map<string, unknown>
): string {
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

export function formatTemplateOutput(
  filled: string,
  format: StructuredPromptConfig["outputFormat"] = "text"
): string {
  if (format === "json") {
    return JSON.stringify({ prompt: filled }, null, 2)
  }

  if (format === "markdown") {
    return `### Prompt\n\n${filled}`
  }

  return filled
}

export function buildPromptPayload(filled: string, systemPrompt?: string) {
  if (!systemPrompt) {
    return filled
  }

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: filled }
  ]
}

export function resolveLanguageModelNamespace(): PromptApiNamespace | undefined {
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

export function coerceJsonLike(rawValue: string): CoercedJsonResult {
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

export function normalizeStructuredOutput(
  value: unknown,
  schema?: Record<string, unknown>
): NormalizedStructuredResult {
  if (!isPlainRecord(value)) {
    return { value, changed: false, modifiedFields: [] }
  }

  const hints = extractSchemaHints(schema)
  STRING_FIELD_SET.forEach((field) => hints.stringProps.add(field))
  STRING_ARRAY_FIELD_SET.forEach((field) => hints.stringArrayProps.add(field))

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

export function buildPreview(value: string, limit = 360) {
  const trimmed = value.trim()
  if (trimmed.length <= limit) {
    return trimmed
  }
  return `${trimmed.slice(0, limit)}…`
}

export function normalizeWeeklyRecap(record: StoredArtifactRecord): WeeklyRecapEntry | null {
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

export function normalizeBlogDigest(record: StoredArtifactRecord): BlogDigestEntry | null {
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

export function buildBlogTagIndex(entries: BlogDigestEntry[]) {
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

export function buildTagSummaries(index: Map<string, BlogDigestEntry[]>) {
  const summaries: BlogTagSummary[] = []
  for (const [tag, entries] of index.entries()) {
    if (tag === "__untagged__") {
      continue
    }
    summaries.push({ tag, count: entries.length })
  }

  return summaries.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export function formatDateRange(start: number, end: number) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  })
  const startText = formatter.format(new Date(start))
  const endText = formatter.format(new Date(end))
  return startText === endText ? startText : `${startText} – ${endText}`
}

export function buildWeeklyPromptSection(entry: WeeklyRecapEntry, index: number) {
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

export function buildBlogDigestSummary({
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

export function buildSpotlightArticles(
  entries: BlogDigestEntry[],
  limit = DEFAULT_SPOTLIGHT_ARTICLE_LIMIT
) {
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

export function buildBlogCollections(
  index: Map<string, BlogDigestEntry[]>,
  limit = DEFAULT_COLLECTION_LIMIT,
  entriesPerTag = DEFAULT_COLLECTION_ENTRIES_PER_TAG
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

export function deriveRecommendedAngles(entries: BlogDigestEntry[], limit = DEFAULT_RECOMMENDED_ANGLES_LIMIT) {
  return collectUniqueStrings(entries.flatMap((entry) => entry.narrativeDirections ?? []), limit)
}

export function collectSupportingLinks(entries: BlogDigestEntry[], limit = DEFAULT_SUPPORTING_LINKS_LIMIT) {
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

export function collectUniqueStrings(values: Iterable<string>, limit?: number) {
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

export function buildStoredPayload(
  rawInput: unknown,
  shouldParse: boolean,
  onParseError?: (message: string) => void
): StoredArtifactPayload {
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim()
    return {
      raw: rawInput,
      parsed: shouldParse ? tryParseJson(trimmed, onParseError) : undefined
    }
  }

  return {
    raw: JSON.stringify(rawInput, null, 2),
    parsed: rawInput
  }
}

function normalizeDraftPullRequest(value: unknown): NormalizedDraft {
  const allowedKeys = new Set(["title", "content", "potentialRegressions", "blastRadius", "testPlan"])
  const result: NormalizedDraft = {
    value: {
      title: "",
      content: "",
      potentialRegressions: [],
      blastRadius: "",
      testPlan: ""
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

  const testPlan = coerceStringField(working.testPlan)
  if (testPlan.changed || testPlan.value !== working.testPlan) {
    result.changed = true
    result.modifiedFields.push("draftPullRequest.testPlan")
  }
  result.value.testPlan = testPlan.value

  if (!result.changed) {
    return {
      value: {
        title: title.value,
        content: content.value,
        potentialRegressions: normalizedRegressions,
        blastRadius: blastRadius.value,
        testPlan: testPlan.value
      },
      changed: false,
      modifiedFields: []
    }
  }

  result.modifiedFields = Array.from(new Set(result.modifiedFields))
  return result
}

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
        .map((part) => part.replace(/^\s*(?:[-*•\?]|\d+[.)])\s*/, "").trim())
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
        "quote",
        "question"
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

function formatDateLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date)
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

function tryParseJson(value: string, onParseError?: (message: string) => void) {
  if (!value) {
    return undefined
  }

  try {
    return JSON.parse(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onParseError?.(message)
    return undefined
  }
}
