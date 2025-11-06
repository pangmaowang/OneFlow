export type PromptApiNamespace = {
  availability?: (options?: Record<string, unknown>) => Promise<string>
  create?: (options?: Record<string, unknown>) => Promise<PromptApiSession>
  params?: () => Promise<Record<string, unknown>>
}

export type PromptApiSession = {
  prompt: (input: unknown, options?: Record<string, unknown>) => Promise<string>
  promptStreaming?: (input: unknown, options?: Record<string, unknown>) => AsyncIterable<string>
  destroy?: () => void
}

export type CoercedJsonResult = {
  text: string
  parsed?: unknown
  source?: "direct" | "fenced" | "balanced" | "trimmed"
}

export type NormalizedStructuredResult = {
  value: unknown
  changed: boolean
  modifiedFields: string[]
}

export type DraftSection = {
  heading: string
  bullets: string[]
}

export type NormalizedDraft = {
  value: {
    title: string
    content: string
    potentialRegressions: string[]
    blastRadius: string
    testPlan: string
  }
  changed: boolean
  modifiedFields: string[]
}

export type NormalizedDraftSections = {
  value: DraftSection[]
  changed: boolean
  modifiedFields: string[]
}

export type WeeklyRecapEntry = {
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

export type BlogDigestEntry = {
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

export type BlogTagSummary = {
  tag: string
  count: number
}

export type BlogDigestResult = {
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
