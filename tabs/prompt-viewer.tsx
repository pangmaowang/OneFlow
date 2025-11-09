import { useCallback, useEffect, useMemo, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  CircleHelp,
  ClipboardCheck,
  ExternalLink,
  Copy,
  FileText,
  FileDown,
  Hash,
  Layers,
  ListChecks,
  NotebookPen,
  Shield,
  Sparkles,
  Star,
  Tags,
  Target
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { storageGet, storageRemove } from "@/lib/chrome-storage"
import { createScopedDebugger } from "@/lib/debug"
import { cn } from "@/lib/utils"

import "@/style.css"

type ViewerPayload = {
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

const debug = createScopedDebugger("tabs/prompt-viewer")

type LoadState = "loading" | "ready" | "error"

type CopyState = {
  target?: string
  status: "idle" | "copied" | "error"
}

function CodeSurface({
  value,
  className,
  withBorder = true
}: {
  value: string
  className?: string
  withBorder?: boolean
}) {
  return (
    <pre
      className={cn(
        "max-h-[60vh] overflow-auto rounded-lg px-4 py-3 text-xs leading-relaxed text-gray-700 dark:text-gray-200",
        withBorder ? "border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" : "bg-transparent",
        className
      )}
    >
      <code className="block whitespace-pre">
        {value}
      </code>
    </pre>
  )
}

function useViewerData() {
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

function useCopy() {
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

type SectionDescriptor = {
  key: string
  title: string
  description?: string
  icon?: LucideIcon
  render: (value: unknown) => React.ReactNode
  copyValue?: (value: unknown) => string | null
}

type DigestSnapshot = {
  label?: string
  detail?: string
  startLabel?: string
  endLabel?: string
  stats: Array<{ key: string; label: string; value: string }>
}

const DIGEST_TOTAL_LABELS: Record<string, string> = {
  notes: "Research notes",
  tags: "Unique tags",
  supportingLinks: "Links saved"
}

function renderDigestSnapshot(value: unknown) {
  const snapshot = normalizeDigestSnapshot(value)
  if (!snapshot) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No timeframe details available.</p>
  }

  const renderDateChip = (label?: string) =>
    label ? (
      <span className="inline-flex items-start gap-2 rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 dark:border-gray-700 dark:text-gray-300">
        <CalendarDays className="mt-0.5 h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
        <span className="pt-0.5 leading-snug">{label}</span>
      </span>
    ) : null

  return (
    <div className="space-y-4 text-sm">
      {snapshot.label ? (
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {snapshot.label}
        </div>
      ) : snapshot.detail ? (
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {snapshot.detail}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-gray-700 dark:text-gray-300">
        {snapshot.startLabel || snapshot.endLabel ? (
          <div className="flex flex-wrap items-center gap-2">
            {renderDateChip(snapshot.startLabel)}
            {snapshot.startLabel && snapshot.endLabel ? (
              <ArrowRight className="h-4 w-4 text-gray-400" />
            ) : null}
            {renderDateChip(snapshot.endLabel)}
          </div>
        ) : null}
        {!snapshot.startLabel && !snapshot.endLabel && snapshot.detail ? (
          <span>{snapshot.detail}</span>
        ) : null}
      </div>
      {snapshot.stats.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {snapshot.stats.map((stat) => (
            <span
              key={stat.key}
              className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              <span className="mr-1.5 text-base font-bold text-gray-800 dark:text-gray-100">
                {stat.value}
              </span>
              {stat.label.toUpperCase()}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function copyDigestSnapshot(value: unknown) {
  const snapshot = normalizeDigestSnapshot(value)
  if (!snapshot) {
    return null
  }

  const lines: string[] = []
  if (snapshot.label) {
    lines.push(`Window: ${snapshot.label}`)
  }
  if (snapshot.detail && snapshot.detail !== snapshot.label) {
    lines.push(`Range: ${snapshot.detail}`)
  }
  if (snapshot.startLabel || snapshot.endLabel) {
    const rangeParts = [snapshot.startLabel, snapshot.endLabel].filter(Boolean)
    if (rangeParts.length) {
      lines.push(`Bounds: ${rangeParts.join(" → ")}`)
    }
  }
  snapshot.stats.forEach((stat) => {
    lines.push(`${stat.label}: ${stat.value}`)
  })

  return lines.length ? lines.join("\n") : null
}

function normalizeDigestSnapshot(value: unknown): DigestSnapshot | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as Record<string, unknown>
  const timeframe = isPlainRecord(record.timeframe) ? (record.timeframe as Record<string, unknown>) : undefined
  const totals = isPlainRecord(record.totals) ? (record.totals as Record<string, unknown>) : undefined

  const label = typeof timeframe?.label === "string" ? timeframe.label.trim() : undefined
  const startISO = typeof timeframe?.startISO === "string" ? timeframe.startISO.trim() : undefined
  const endISO = typeof timeframe?.endISO === "string" ? timeframe.endISO.trim() : undefined

  const startLabel = formatSnapshotDate(startISO)
  const endLabel = formatSnapshotDate(endISO)
  const rangeDetail = [startLabel, endLabel].filter(Boolean).join(" → ") || undefined

  const stats: Array<{ key: string; label: string; value: string }> = []
  if (totals) {
    for (const [key, rawValue] of Object.entries(totals)) {
      if (typeof rawValue === "number") {
        stats.push({
          key,
          label: DIGEST_TOTAL_LABELS[key] ?? formatKeyLabel(key),
          value: rawValue.toLocaleString()
        })
        continue
      }

      if (typeof rawValue === "string" && rawValue.trim()) {
        stats.push({
          key,
          label: DIGEST_TOTAL_LABELS[key] ?? formatKeyLabel(key),
          value: rawValue.trim()
        })
      }
    }
  }

  if (!label && !rangeDetail && !stats.length) {
    return null
  }

  return {
    label: label || rangeDetail,
    detail: label ? rangeDetail : undefined,
    startLabel,
    endLabel,
    stats
  }
}

function formatSnapshotDate(iso?: string) {
  if (!iso) {
    return undefined
  }

  const trimmed = iso.trim()
  if (!trimmed) {
    return undefined
  }

  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    })
  }

  return trimmed
}

const DIGEST_SNAPSHOT_SECTION: SectionDescriptor = {
  key: "digestSnapshot",
  title: "Digest snapshot",
  description: "Time window and totals at a glance.",
  icon: CalendarDays,
  render: renderDigestSnapshot,
  copyValue: copyDigestSnapshot
}

const SECTION_LIBRARY: SectionDescriptor[] = [
  {
    key: "summary",
    title: "Summary",
    description: "High-level recap of the input.",
    icon: FileText,
    render: (value) =>
      typeof value === "string" ? (
  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">{value}</p>
      ) : null,
    copyValue: (value) => (typeof value === "string" && value ? value : null)
  },
  {
    key: "suggestedClarifications",
    title: "Suggested clarifications",
    description: "Questions or gaps to resolve before implementation.",
    icon: CircleHelp,
    render: (value) => renderStringList(value, "No clarifications provided."),
    copyValue: (value) => copyStringList(value)
  },
  {
    key: "tags",
    title: "Tags",
    description: "Topic handles to group related research.",
    icon: Tags,
    render: (value) => renderStringList(value, "No tags captured."),
    copyValue: (value) => copyStringList(value)
  },
  {
    key: "topTags",
    title: "Top tags",
    description: "Most referenced themes from the selected window.",
    icon: Hash,
    render: (value) => renderTagStats(value),
    copyValue: (value) => copyTagStats(value)
  },
  {
    key: "riskLevel",
    title: "Risk level",
    description: "System risk assessment based on the prompt result.",
    icon: Shield,
    render: (value) => <RiskBadge value={typeof value === "string" ? value : undefined} />,
    copyValue: (value) => (typeof value === "string" ? value : null)
  },
  {
    key: "testPlan",
    title: "Test plan ideas",
    description: "Suggested validations to cover before shipping.",
    icon: ListChecks,
    render: (value) => renderStringList(value, "No test plan suggestions available."),
    copyValue: (value) => copyStringList(value)
  },
  {
    key: "actionItems",
    title: "Action items",
    description: "Explicit follow-ups extracted from the prompt output.",
    icon: ClipboardCheck,
    render: (value) => renderStringList(value, "No action items captured."),
    copyValue: (value) => copyStringList(value)
  },
  {
    key: "spotlightArticles",
    title: "Spotlight articles",
    description: "Standout sources worth elevating in planning notes.",
    icon: Star,
    render: (value) => renderSpotlightArticles(value),
    copyValue: (value) => copySpotlightArticles(value)
  },
  {
    key: "highlights",
    title: "Highlights",
    description: "Key wins or notable updates surfaced by the automation.",
    icon: Sparkles,
    render: (value) => renderStringList(value, "No highlights detected."),
    copyValue: (value) => copyStringList(value)
  },
  {
    key: "blockers",
    title: "Blockers",
    description: "Stated risks or impediments from the summary.",
    icon: AlertTriangle,
    render: (value) => renderStringList(value, "No blockers recorded."),
    copyValue: (value) => copyStringList(value)
  },
  {
    key: "nextFocus",
    title: "Next focus",
    description: "Upcoming priorities inferred from the notes.",
    icon: Target,
    render: (value) => renderStringList(value, "No upcoming focus recorded."),
    copyValue: (value) => copyStringList(value)
  },
  {
    key: "collections",
    title: "Tag collections",
    description: "Dive into each tag’s narrative arc across collected notes.",
    icon: Layers,
    render: (value) => renderBlogCollections(value),
    copyValue: (value) => copyBlogCollections(value)
  },
  {
    key: "recommendedAngles",
    title: "Recommended angles",
    description: "Editorial directions to explore next.",
    icon: NotebookPen,
    render: (value) => renderStringList(value, "No angles suggested."),
    copyValue: (value) => copyStringList(value)
  },
  {
    key: "supportingLinks",
    title: "Supporting links",
    description: "Curated references to revisit or share.",
    icon: Tags,
    render: (value) => renderLinkList(value),
    copyValue: (value) => copyLinkList(value)
  }
]

const WIDE_SECTION_KEYS = new Set([
  "digestSnapshot",
  "summary",
  "topTags",
  "collections",
  "spotlightArticles",
  "dailyBreakdown",
  "highlights",
  "blockers",
  "nextFocus",
  "actionItems",
  "suggestedClarifications",
  "testPlan"
])

function resolveStructuredPayload(payload: ViewerPayload | null) {
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

function buildSections(parsed: unknown) {
  if (parsed === null || parsed === undefined) {
    return [] as Array<{ descriptor: SectionDescriptor; value: unknown }>
  }

  if (Array.isArray(parsed)) {
    return [
      {
        descriptor: {
          key: "root-items",
          title: "Structured items",
          description: "Array output from the automation run.",
          icon: ListChecks,
          render: (value) => renderDynamicValue(value)
        },
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
          icon: FileText,
          render: (value) => renderDynamicValue(value)
        },
        value: parsed
      }
    ]
  }

  if (!parsed || typeof parsed !== "object") {
    return [] as Array<{ descriptor: SectionDescriptor; value: unknown }>
  }

  const record = parsed as Record<string, unknown>
  const recognized: Array<{ descriptor: SectionDescriptor; value: unknown }> = []

  if (Object.prototype.hasOwnProperty.call(record, "timeframe") || Object.prototype.hasOwnProperty.call(record, "totals")) {
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
    .filter(([key]) =>
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

function renderStringList(value: unknown, emptyCopy: string) {
  const entries = normalizeStringList(value)
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{emptyCopy}</p>
  }

  return (
    <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
      {entries.map((item, index) => (
        <li key={`${item}_${index}`}>{item}</li>
      ))}
    </ul>
  )
}

function copyStringList(value: unknown) {
  const entries = normalizeStringList(value)
  return entries.length > 0 ? entries.join("\n") : null
}

type TagStat = {
  tag: string
  count: number
}

function normalizeTagStats(value: unknown): TagStat[] {
  if (!value) {
    return []
  }

  const arrayValue = Array.isArray(value) ? value : [value]
  const stats: TagStat[] = []

  arrayValue.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return
    }
    const record = entry as Record<string, unknown>
    const tag = typeof record.tag === "string" ? record.tag.trim() : undefined
    const count = typeof record.count === "number" ? record.count : undefined
    if (!tag || tag.length === 0) {
      return
    }
    stats.push({ tag, count: count ?? 0 })
  })

  return stats
}

function renderTagStats(value: unknown) {
  const stats = normalizeTagStats(value)
  if (stats.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No tag activity recorded.</p>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {stats.map((stat) => (
        <span
          key={stat.tag}
          className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          #{stat.tag}
          <span className="ml-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            {stat.count}
          </span>
        </span>
      ))}
    </div>
  )
}

function copyTagStats(value: unknown) {
  const stats = normalizeTagStats(value)
  if (stats.length === 0) {
    return null
  }
  return stats.map((stat) => `${stat.tag}: ${stat.count}`).join("\n")
}

type SpotlightArticle = {
  id: string
  date?: string
  summary: string
  tags: string[]
  keyInsights: string[]
  technicalHighlights: string[]
  supportingLinks: string[]
  sourceUrl?: string
}

function normalizeSpotlightArticles(value: unknown): SpotlightArticle[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null
      }

      const record = entry as Record<string, unknown>
      const summary = typeof record.summary === "string" ? record.summary.trim() : ""
      if (!summary) {
        return null
      }

      const idValue = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `spotlight-${index}`
      const date = typeof record.date === "string" ? record.date.trim() : undefined
      const tags = normalizeStringList(record.tags)
      const keyInsights = normalizeStringList(record.keyInsights)
      const technicalHighlights = normalizeStringList(record.technicalHighlights)
      const supportingLinks = normalizeStringList(record.supportingLinks)
      const sourceUrl = typeof record.sourceUrl === "string" ? record.sourceUrl.trim() : undefined

      const result: SpotlightArticle = {
        id: idValue,
        summary,
        tags,
        keyInsights,
        technicalHighlights,
        supportingLinks
      }

      if (date) {
        result.date = date
      }
      if (sourceUrl) {
        result.sourceUrl = sourceUrl
      }

      return result
    })
    .filter(Boolean)

  return normalized as SpotlightArticle[]
}

function renderSpotlightArticles(value: unknown) {
  const articles = normalizeSpotlightArticles(value)
  if (articles.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No spotlight articles selected.</p>
  }

  const resolveHost = (url?: string) => {
    if (!url) {
      return undefined
    }
    try {
      const host = new URL(url).hostname.replace(/^www\./, "")
      return host || undefined
    } catch {
      return undefined
    }
  }

  const renderDetailList = (label: string, items: string[], keyPrefix: string) => (
    <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </h4>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        {items.map((item, index) => (
          <li key={`${keyPrefix}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  )

  return (
    <div className="space-y-6">
      {articles.map((article) => {
        const host = resolveHost(article.sourceUrl)
        const links = article.supportingLinks.length
          ? article.supportingLinks
          : article.sourceUrl
          ? [article.sourceUrl]
          : []

        return (
          <div
            key={article.id}
            className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900/50"
          >
            <div className="space-y-3">
              <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-300">
                {article.summary}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                {article.date ? <span>{article.date}</span> : null}
                {host ? <span>· {host}</span> : null}
              </div>
            </div>

            {article.tags.length ? (
              <div className="flex flex-wrap gap-2">
                {article.tags.map((tag) => (
                  <span
                    key={`${article.id}-${tag}`}
                    className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}

            {article.keyInsights.length
              ? renderDetailList("Key insights", article.keyInsights, `${article.id}-insight`)
              : null}

            {article.technicalHighlights.length
              ? renderDetailList("Technical takeaways", article.technicalHighlights, `${article.id}-tech`)
              : null}

            {links.length ? (
              <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Links
                </h4>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
                  {links.map((link, index) => (
                    <li key={`${article.id}-link-${index}`}>
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-start gap-2 text-gray-800 underline decoration-dotted underline-offset-4 hover:text-primary dark:text-gray-200"
                      >
                        <ExternalLink className="mt-0.5 h-4 w-4" />
                        <span className="pt-0.5 leading-tight">{link}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function copySpotlightArticles(value: unknown) {
  const articles = normalizeSpotlightArticles(value)
  if (articles.length === 0) {
    return null
  }

  return articles
    .map((article) => {
      const lines = [article.summary]
      if (article.date) {
        lines.push(`Date: ${article.date}`)
      }
      if (article.tags.length) {
        lines.push(`Tags: ${article.tags.join(", ")}`)
      }
      if (article.keyInsights.length) {
        lines.push(`Key insights: ${article.keyInsights.join("; ")}`)
      }
      if (article.technicalHighlights.length) {
        lines.push(`Technical: ${article.technicalHighlights.join("; ")}`)
      }
      if (article.supportingLinks.length) {
        lines.push(`Links: ${article.supportingLinks.join(", ")}`)
      } else if (article.sourceUrl) {
        lines.push(`Link: ${article.sourceUrl}`)
      }
      return lines.join("\n")
    })
    .join("\n\n")
}

type BlogCollectionEntry = {
  id: string
  summary: string
  keyInsights: string[]
  supportingLinks: string[]
  dateLabel?: string
}

type BlogCollection = {
  id: string
  label: string
  tag: string
  synopsis: string
  entries: BlogCollectionEntry[]
}

function normalizeBlogCollections(value: unknown): BlogCollection[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null
      }

      const record = entry as Record<string, unknown>
      const tag = typeof record.tag === "string" ? record.tag.trim() : ""
      const synopsis = typeof record.synopsis === "string" ? record.synopsis.trim() : ""
      const entriesValue = Array.isArray(record.entries) ? record.entries : []
      const normalizedEntries = entriesValue
        .map((child, childIndex) => {
          if (!child || typeof child !== "object") {
            return null
          }

          const childRecord = child as Record<string, unknown>
          const summary = typeof childRecord.summary === "string" ? childRecord.summary.trim() : ""
          if (!summary) {
            return null
          }

          const entryId =
            typeof childRecord.id === "string" && childRecord.id.trim()
              ? childRecord.id.trim()
              : `${tag || "collection"}-${childIndex}`

          const keyInsights = normalizeStringList(childRecord.keyInsights)
          const supportingLinks = normalizeStringList(childRecord.supportingLinks)
          const dateLabel =
            typeof childRecord.dateLabel === "string" && childRecord.dateLabel.trim()
              ? childRecord.dateLabel.trim()
              : undefined

          const item: BlogCollectionEntry = {
            id: entryId,
            summary,
            keyInsights,
            supportingLinks
          }

          if (dateLabel) {
            item.dateLabel = dateLabel
          }

          return item
        })
        .filter(Boolean)

      if (normalizedEntries.length === 0) {
        return null
      }

      const label = tag || `Collection ${index + 1}`
      const sanitized = sanitizeFileSegment(label)

      const collection: BlogCollection = {
        id: sanitized || `collection-${index}`,
        label,
        tag: label,
        synopsis,
        entries: normalizedEntries
      }

      return collection
    })
    .filter(Boolean)

  return normalized as BlogCollection[]
}

function renderBlogCollections(value: unknown) {
  const collections = normalizeBlogCollections(value)
  if (collections.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No tag collections available.</p>
  }

  return (
    <div className="space-y-6">
      {collections.map((collection) => (
        <div
          key={collection.id}
          className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
        >
          <div className="flex flex-wrap items-start gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/60">
            <span className="inline-flex items-center gap-2 rounded-full bg-gray-900/10 px-4 py-1.5 text-sm font-semibold text-gray-800 shadow-sm ring-1 ring-gray-900/10 dark:bg-gray-50/10 dark:text-gray-100 dark:ring-gray-100/10">
              <span className="text-base leading-none">#{collection.tag}</span>
            </span>
            {collection.synopsis ? (
              <p className="text-sm text-gray-700 dark:text-gray-300">{collection.synopsis}</p>
            ) : null}
          </div>

          <div className="space-y-3 p-4">
            {collection.entries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-dashed border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{entry.summary}</p>
                  {entry.dateLabel ? (
                    <span className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      {entry.dateLabel}
                    </span>
                  ) : null}
                </div>
                {entry.keyInsights.length ? (
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-xs text-gray-700 dark:text-gray-300">
                    {entry.keyInsights.map((item, index) => (
                      <li key={`${entry.id}-insight-${index}`}>{item}</li>
                    ))}
                  </ul>
                ) : null}
                {entry.supportingLinks.length ? (
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-xs">
                    {entry.supportingLinks.map((link, index) => (
                      <li key={`${entry.id}-link-${index}`}>
                        <a
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-gray-700 underline decoration-dotted underline-offset-2 hover:text-primary dark:text-gray-300"
                        >
                          {link}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function copyBlogCollections(value: unknown) {
  const collections = normalizeBlogCollections(value)
  if (collections.length === 0) {
    return null
  }

  return collections
    .map((collection) => {
      const lines = [collection.label]
      if (collection.synopsis) {
        lines.push(collection.synopsis)
      }
      collection.entries.forEach((entry) => {
        lines.push(`- ${entry.summary}`)
        if (entry.keyInsights.length) {
          lines.push(`  · Insights: ${entry.keyInsights.join("; ")}`)
        }
        if (entry.supportingLinks.length) {
          lines.push(`  · Links: ${entry.supportingLinks.join(", ")}`)
        }
        if (entry.dateLabel) {
          lines.push(`  · Date: ${entry.dateLabel}`)
        }
      })
      return lines.join("\n")
    })
    .join("\n\n")
}

function renderLinkList(value: unknown) {
  const links = normalizeStringList(value)
  if (links.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No supporting links provided.</p>
  }

  return (
    <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
      {links.map((link, index) => (
        <li key={`${link}-${index}`}>
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-primary"
          >
            {link}
          </a>
        </li>
      ))}
    </ul>
  )
}

function copyLinkList(value: unknown) {
  const links = normalizeStringList(value)
  return links.length ? links.join("\n") : null
}

function normalizeStringList(value: unknown): string[] {
  const unique = new Set<string>()

  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
        const normalized = String(item).trim()
        if (normalized) {
          unique.add(normalized)
        }
      } else if (item && typeof item === "object") {
        normalizeStringList(item).forEach((entry) => unique.add(entry))
      }
    })
    return Array.from(unique)
  }

  if (typeof value === "string") {
    value
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((entry) => unique.add(entry))
    return Array.from(unique)
  }

  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => {
      if (typeof item === "string") {
        const normalized = item.trim()
        if (normalized) {
          unique.add(normalized)
        }
      }
    })
    return Array.from(unique)
  }

  return []
}

function renderDynamicValue(value: unknown, depth = 0): React.ReactNode {
  if (value === null || value === undefined) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">—</p>
  }

  if (typeof value === "string") {
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        {value}
      </p>
    )
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
        {String(value)}
      </span>
    )
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <p className="text-sm text-gray-500 dark:text-gray-400">(empty list)</p>
    }

    const primitives = value.every(isPrimitive)
    if (primitives) {
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
          {value.map((item, index) => (
            <li key={`${item}_${index}`}>{String(item)}</li>
          ))}
        </ul>
      )
    }

    return (
      <div className="space-y-3">
        {value.map((entry, index) => (
          <div
            key={index}
            className={cn(
              "rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/40",
              depth > 0 ? "bg-gray-100 dark:bg-gray-900/60" : undefined
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Item {index + 1}
            </p>
            <div className="mt-2 space-y-2">
              {renderDynamicValue(entry, depth + 1)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (isPlainRecord(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      return <p className="text-sm text-gray-500 dark:text-gray-400">(empty object)</p>
    }

    return (
      <div className="space-y-2">
        {entries.map(([key, entryValue]) => (
          <div
            key={key}
            className={cn(
              "rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/40",
              depth > 0 ? "bg-gray-100/70 dark:bg-gray-900/70" : undefined
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {formatKeyLabel(key)}
            </p>
            <div className="mt-1 space-y-1">
              {renderDynamicValue(entryValue, depth + 1)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  try {
    return <CodeSurface value={JSON.stringify(value, null, 2)} className="max-h-48" />
  } catch (_error) {
    return <CodeSurface value={String(value)} className="max-h-48" />
  }
}

function formatKeyLabel(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/^./, (char) => char.toUpperCase())
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp))
}

function RiskBadge({ value }: { value?: string }) {
  if (!value) {
    return null
  }

  const normalized = value.toLowerCase()
  const variant =
    normalized === "high"
      ? ("destructive" as const)
      : normalized === "medium"
      ? ("warning" as const)
      : ("success" as const)

  return <Badge variant={variant}>Risk: {value}</Badge>
}

function buildExportFileName(taskName: string | undefined, extension: string, createdAt?: number) {
  const base = sanitizeFileSegment(taskName ?? "automation-result")
  const timestamp = buildExportTimestamp(createdAt)
  return `${base}-${timestamp}.${extension}`
}

function sanitizeFileSegment(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || "automation-result"
}

function buildExportTimestamp(createdAt?: number) {
  const source = createdAt ? new Date(createdAt) : new Date()
  return source.toISOString().replace(/[:.]/g, "-")
}

function buildMarkdownExport(structured: unknown, payload: ViewerPayload | null): string {
  const title = payload?.meta?.taskName ?? "Automation result"
  const generatedAt = payload?.createdAt
    ? new Date(payload.createdAt).toLocaleString()
    : null
  const rawOutput = payload?.raw ?? ""
  const lines: string[] = [`# ${title}`, ""]

  const addDivider = () => {
    if (lines.length === 0) {
      return
    }
    if (lines[lines.length - 1] !== "") {
      lines.push("")
    }
    lines.push("---")
    lines.push("")
  }

  if (generatedAt) {
    lines.push(`> **Generated:** ${generatedAt}`, "")
    addDivider()
  }

  if (structured === undefined || structured === null) {
    if (rawOutput) {
      lines.push("```text", rawOutput, "```")
    } else {
      lines.push("_No structured output available._")
    }
    return lines.join("\n")
  }

  if (typeof structured === "string") {
    lines.push(structured)
    if (rawOutput) {
      lines.push("", "## Raw Output", "", "```text", rawOutput, "```")
    }
    return lines.join("\n")
  }

  if (Array.isArray(structured)) {
    if (structured.every(isPrimitive)) {
      structured.forEach((item) => {
        lines.push(`- ${String(item)}`)
      })
    } else {
      lines.push("```json", JSON.stringify(structured, null, 2), "```")
    }

    if (rawOutput) {
      lines.push("", "## Raw Output", "", "```text", rawOutput, "```")
    }

    return lines.join("\n")
  }

  if (!isPlainRecord(structured)) {
    lines.push("```text", String(structured), "```")
    if (rawOutput) {
      lines.push("", "## Raw Output", "", "```text", rawOutput, "```")
    }
    return lines.join("\n")
  }

  const record = structured as Record<string, unknown>
  const handled = new Set<string>()

  const summary = typeof record.summary === "string" ? record.summary.trim() : ""
  if (summary) {
    lines.push("## Summary", "")
    lines.push(`> ${summary}`)
    lines.push("")
    addDivider()
    handled.add("summary")
  }

  const listSections: Array<{ key: string; title: string }> = [
    { key: "keyInsights", title: "Key insights" },
    { key: "technicalHighlights", title: "Technical highlights" },
    { key: "narrativeDirections", title: "Narrative directions" },
    { key: "supportingLinks", title: "Supporting links" },
    { key: "tags", title: "Tags" },
    { key: "highlights", title: "Highlights" },
    { key: "blockers", title: "Blockers" },
    { key: "nextFocus", title: "Next focus" },
    { key: "actionItems", title: "Action items" },
    { key: "suggestedClarifications", title: "Suggested clarifications" },
    { key: "testPlan", title: "Test plan" }
  ]

  listSections.forEach(({ key, title }) => {
    const entries = normalizeStringList(record[key])
    if (entries.length === 0) {
      return
    }
    lines.push(`## ${title}`, "")
    lines.push("_Key points:_", "")
    entries.forEach((entry) => {
      lines.push(`- ${entry}`)
    })
    lines.push("")
    addDivider()
    handled.add(key)
  })

  const breakdownRaw = Array.isArray(record.dailyBreakdown) ? record.dailyBreakdown : []
  const breakdown = breakdownRaw.filter((entry): entry is Record<string, unknown> =>
    isPlainRecord(entry)
  )

  if (breakdown.length > 0) {
    lines.push("## Daily Breakdown", "")
    breakdown.forEach((entry, index) => {
      const label =
        typeof entry.date === "string" && entry.date.trim()
          ? entry.date.trim()
          : `Day ${index + 1}`
      lines.push(`### ${label}`, "")
      const daySummary = typeof entry.summary === "string" ? entry.summary.trim() : ""
      if (daySummary) {
        lines.push(`> ${daySummary}`, "")
      }

      const daySections: Array<{ key: string; title: string }> = [
        { key: "highlights", title: "Highlights" },
        { key: "blockers", title: "Blockers" },
        { key: "nextFocus", title: "Next focus" },
        { key: "actionItems", title: "Action items" }
      ]

      daySections.forEach(({ key, title }) => {
        const items = normalizeStringList(entry[key])
        if (items.length === 0) {
          return
        }
        lines.push(`- **${title}:**`)
        items.forEach((item) => {
          lines.push(`  - ${item}`)
        })
      })

      if (lines[lines.length - 1] !== "") {
        lines.push("")
      }
    })

    addDivider()
    handled.add("dailyBreakdown")
  }

  Object.entries(record).forEach(([key, value]) => {
    if (handled.has(key)) {
      return
    }
    if (value === undefined || value === null) {
      return
    }

    lines.push(`## ${formatKeyLabel(key)}`, "")

    if (typeof value === "string") {
      const trimmed = value.trim()
      if (trimmed) {
        lines.push(trimmed, "")
      }
      addDivider()
      return
    }

    if (Array.isArray(value) && value.every(isPrimitive)) {
      value.forEach((item) => {
        lines.push(`- ${String(item)}`)
      })
      lines.push("")
      addDivider()
      return
    }

    lines.push("```json", JSON.stringify(value, null, 2), "```", "")
    addDivider()
  })

  if (rawOutput) {
    lines.push("## Raw Output", "", "```text", rawOutput, "```")
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop()
  }

  if (lines.length > 0 && lines[lines.length - 1] === "---") {
    lines.pop()
  }

  return lines.join("\n")
}

function triggerDownload(filename: string, content: string, mimeType: string) {
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

export default function PromptViewer() {
  const { state, payload, errorMessage } = useViewerData()
  const { copyState, copy } = useCopy()

  const structuredPayload = useMemo(() => resolveStructuredPayload(payload), [payload])
  const sections = useMemo(() => buildSections(structuredPayload), [structuredPayload])
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

  if (state === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted text-muted-foreground">
        <p className="text-sm">Loading structured result…</p>
      </div>
    )
  }

  if (state === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted text-muted-foreground">
        <Card className="w-[480px] max-w-full border-destructive/40 bg-destructive/10 text-destructive">
          <CardHeader>
            <CardTitle className="text-base">Unable to load result</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{errorMessage ?? "Unknown error."}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="space-y-4">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Result snapshot
              </p>
              <h1 className="text-2xl font-semibold md:text-3xl">Automation playback</h1>
              <p className="max-w-3xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                Skim the structured recap without digging through raw notes—the viewer keeps the highlights, risks, and next moves front and center.
              </p>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {payload?.meta?.taskName ?? "Automation output"}
              {payload?.createdAt ? ` · ${formatDate(payload.createdAt)}` : null}
            </p>
            {payload ? (
              <button
                type="button"
                onClick={handleExportMarkdown}
                className="inline-flex items-start gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 focus:ring-offset-white hover:bg-gray-800 dark:bg-gray-50 dark:text-gray-900 dark:hover:bg-gray-200 dark:focus:ring-gray-100 dark:focus:ring-offset-gray-900"
              >
                <FileDown className="mt-0.5 h-4 w-4" aria-hidden="true" />
                <span className="pt-0.5 leading-tight">Download report</span>
              </button>
            ) : null}
          </div>
        </section>

        {sections.length === 0 ? (
          <section className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              No structured result
            </h2>
            <p className="mt-2 text-sm">
              The automation returned data that doesn&apos;t map to the usual sections.
            </p>
            <p className="mt-4 text-sm">
              Re-run the flow or tweak your prompt so it emits structured fields like summary, highlights, or action items.
            </p>
            {payload?.raw ? (
              <div className="mt-6 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Raw output
                </p>
                <CodeSurface value={payload.raw} className="mt-1" />
              </div>
            ) : null}
          </section>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {sections.map(({ descriptor, value }) => {
              const allowCopy = descriptor.copyValue?.(value)
              const Icon = descriptor.icon
              const layoutClass = WIDE_SECTION_KEYS.has(descriptor.key)
                ? "lg:col-span-2"
                : "lg:col-span-1"

              return (
                <section
                  key={descriptor.key}
                  className={cn(
                    "relative rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900",
                    layoutClass
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      {Icon ? (
                        <span className="flex h-10 w-10 items-start justify-center rounded-full bg-gray-100 pt-1 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                      ) : null}
                      <div className="space-y-1">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                          {descriptor.title}
                        </h2>
                        {descriptor.description ? (
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {descriptor.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {allowCopy ? (
                      <CopyButton
                        target={descriptor.key}
                        copyState={copyState}
                        onCopy={() => copy(descriptor.key, allowCopy)}
                        className="self-start"
                      >
                        Copy
                      </CopyButton>
                    ) : null}
                  </div>
                  <div className="mt-6 border-t border-gray-200 pt-6 dark:border-gray-800">
                    {descriptor.render(value)}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

type CopyButtonProps = {
  target: string
  copyState: CopyState
  onCopy: () => void
  children: React.ReactNode
  className?: string
}

function CopyButton({
  target,
  copyState,
  onCopy,
  children,
  className
}: CopyButtonProps) {
  const status = copyState.target === target ? copyState.status : "idle"
  const Icon = status === "copied" ? Check : Copy
  const label = status === "copied" ? "COPIED" : String(children)

  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn(
        "inline-flex items-start gap-2 rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wider transition focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2 focus:ring-offset-white hover:text-gray-700 dark:focus:ring-gray-600 dark:focus:ring-offset-gray-900",
        status === "copied"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-gray-500 dark:text-gray-400",
        className
      )}
    >
      <Icon className="mt-0.5 h-4 w-4" aria-hidden="true" />
      <span className="pt-0.5 leading-tight">{label}</span>
    </button>
  )
}
