import React from "react"

import {
  AlertTriangle,
  CalendarDays,
  CircleHelp,
  ClipboardCheck,
  ExternalLink,
  FileText,
  ArrowRight,
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
import { cn } from "@/lib/utils"

import { CodeSurface } from "./components/code-surface"
import type {
  BlogCollection,
  BlogCollectionEntry,
  DigestSnapshot,
  SectionDescriptor,
  SpotlightArticle,
  TagStat
} from "./types"
import { buildExportTimestamp, formatKeyLabel, isPlainRecord, isPrimitive, normalizeStringList, sanitizeFileSegment } from "./utils"

function RiskBadge({ value }: { value?: string }) {
  if (!value) {
    return null
  }

  const normalized = value.toLowerCase()
  const variant =
    normalized === "high" ? ("destructive" as const) : normalized === "medium" ? ("warning" as const) : ("success" as const)

  return <Badge variant={variant}>Risk: {value}</Badge>
}

const DIGEST_TOTAL_LABELS: Record<string, string> = {
  notes: "Research notes",
  tags: "Unique tags",
  supportingLinks: "Links saved"
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

export function normalizeDigestSnapshot(value: unknown): DigestSnapshot | null {
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

export function renderDigestSnapshot(value: unknown) {
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
        {!snapshot.startLabel && !snapshot.endLabel && snapshot.detail ? <span>{snapshot.detail}</span> : null}
      </div>
      {snapshot.stats.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {snapshot.stats.map((stat) => (
            <span
              key={stat.key}
              className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              <span className="mr-1.5 text-base font-bold text-gray-800 dark:text-gray-100">{stat.value}</span>
              {stat.label.toUpperCase()}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function copyDigestSnapshot(value: unknown) {
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

export function renderStringList(value: unknown, emptyCopy: string) {
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

export function copyStringList(value: unknown) {
  const entries = normalizeStringList(value)
  return entries.length > 0 ? entries.join("\n") : null
}

export function normalizeTagStats(value: unknown): TagStat[] {
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

export function renderTagStats(value: unknown) {
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

export function copyTagStats(value: unknown) {
  const stats = normalizeTagStats(value)
  if (stats.length === 0) {
    return null
  }
  return stats.map((stat) => `${stat.tag}: ${stat.count}`).join("\n")
}

export function normalizeSpotlightArticles(value: unknown): SpotlightArticle[] {
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

export function renderSpotlightArticles(value: unknown) {
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
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</h4>
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
              <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-300">{article.summary}</p>
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

            {article.keyInsights.length ? renderDetailList("Key insights", article.keyInsights, `${article.id}-insight`) : null}

            {article.technicalHighlights.length
              ? renderDetailList("Technical takeaways", article.technicalHighlights, `${article.id}-tech`)
              : null}

            {links.length ? (
              <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Links</h4>
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

export function copySpotlightArticles(value: unknown) {
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

export function normalizeBlogCollections(value: unknown): BlogCollection[] {
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

      return {
        id: sanitized || `collection-${index}`,
        label,
        tag: label,
        synopsis,
        entries: normalizedEntries
      }
    })
    .filter(Boolean)

  return normalized as BlogCollection[]
}

export function renderBlogCollections(value: unknown) {
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
            {collection.synopsis ? <p className="text-sm text-gray-700 dark:text-gray-300">{collection.synopsis}</p> : null}
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
                    <span className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{entry.dateLabel}</span>
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

export function copyBlogCollections(value: unknown) {
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

export function renderLinkList(value: unknown) {
  const links = normalizeStringList(value)
  if (links.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No supporting links provided.</p>
  }

  return (
    <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
      {links.map((link, index) => (
        <li key={`${link}-${index}`}>
          <a href={link} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-primary">
            {link}
          </a>
        </li>
      ))}
    </ul>
  )
}

export function copyLinkList(value: unknown) {
  const links = normalizeStringList(value)
  return links.length ? links.join("\n") : null
}

export function renderDynamicValue(value: unknown, depth = 0): React.ReactNode {
  if (value === null || value === undefined) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">—</p>
  }

  if (typeof value === "string") {
    return <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">{value}</p>
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
              depth > 0 ? "bg-gray-100 dark:bg-gray-900/60" : null
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Item {index + 1}</p>
            <div className="mt-2 space-y-2">{renderDynamicValue(entry, depth + 1)}</div>
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
              depth > 0 ? "bg-gray-100/70 dark:bg-gray-900/70" : null
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{formatKeyLabel(key)}</p>
            <div className="mt-1 space-y-1">{renderDynamicValue(entryValue, depth + 1)}</div>
          </div>
        ))}
      </div>
    )
  }

  try {
    return <CodeSurface value={JSON.stringify(value, null, 2)} className="max-h-48" />
  } catch {
    return <CodeSurface value={String(value)} className="max-h-48" />
  }
}

export const DIGEST_SNAPSHOT_SECTION: SectionDescriptor = {
  key: "digestSnapshot",
  title: "Digest snapshot",
  description: "Time window and totals at a glance.",
  icon: CalendarDays,
  render: renderDigestSnapshot,
  copyValue: copyDigestSnapshot
}

export const SECTION_LIBRARY: SectionDescriptor[] = [
  {
    key: "summary",
    title: "Summary",
    description: "High-level recap of the input.",
    icon: FileText,
    render: (value) => (typeof value === "string" ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">{value}</p> : null),
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

export const WIDE_SECTION_KEYS = new Set([
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

export function buildMarkdownExportLines(
  structured: unknown,
  rawOutput: string,
  payloadTitle: string,
  generatedAt?: string | null
) {
  const lines: string[] = [`# ${payloadTitle}`, ""]

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
    return lines
  }

  if (typeof structured === "string") {
    lines.push(structured)
    if (rawOutput) {
      lines.push("", "## Raw Output", "", "```text", rawOutput, "```")
    }
    return lines
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

    return lines
  }

  if (!isPlainRecord(structured)) {
    lines.push("```text", String(structured), "```")
    if (rawOutput) {
      lines.push("", "## Raw Output", "", "```text", rawOutput, "```")
    }
    return lines
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
  const breakdown = breakdownRaw.filter((entry): entry is Record<string, unknown> => isPlainRecord(entry))

  if (breakdown.length > 0) {
    lines.push("## Daily Breakdown", "")
    breakdown.forEach((entry, index) => {
      const label =
        typeof entry.date === "string" && entry.date.trim() ? entry.date.trim() : `Day ${index + 1}`
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

  return lines
}

export function buildMarkdownExport(structured: unknown, rawOutput: string, payloadTitle: string, generatedAt?: string | null) {
  return buildMarkdownExportLines(structured, rawOutput, payloadTitle, generatedAt).join("\n")
}

export function buildExportFileName(taskName: string | undefined, extension: string, createdAt?: number) {
  const base = sanitizeFileSegment(taskName ?? "automation-result")
  const timestamp = buildExportTimestamp(createdAt)
  return `${base}-${timestamp}.${extension}`
}
