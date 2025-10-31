import { useCallback, useEffect, useMemo, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  AlertTriangle,
  Check,
  CircleHelp,
  ClipboardCheck,
  Copy,
  FileText,
  FileDown,
  ListChecks,
  Shield,
  Sparkles,
  Tags,
  Target
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
        "max-h-[60vh] overflow-auto rounded-lg px-4 py-3 text-xs leading-relaxed text-muted-foreground",
        withBorder ? "border border-border/60 bg-muted/40" : "bg-transparent",
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

const SECTION_LIBRARY: SectionDescriptor[] = [
  {
    key: "summary",
    title: "Summary",
    description: "High-level recap of the input.",
    icon: FileText,
    render: (value) =>
      typeof value === "string" ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{value}</p>
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
  }
]

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
  const recognized = SECTION_LIBRARY.reduce<Array<{ descriptor: SectionDescriptor; value: unknown }>>(
    (acc, section) => {
      if (record[section.key] !== undefined) {
        acc.push({ descriptor: section, value: record[section.key] })
      }
      return acc
    },
    []
  )

  const extras = Object.entries(record)
    .filter(([key]) => !SECTION_LIBRARY.some((section) => section.key === key))
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
    return <p className="text-sm text-muted-foreground">{emptyCopy}</p>
  }

  return (
    <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
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
    return <p className="text-sm text-muted-foreground">—</p>
  }

  if (typeof value === "string") {
    return <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{value}</p>
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <Badge variant="outline" className="text-xs">
        {String(value)}
      </Badge>
    )
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <p className="text-sm text-muted-foreground">(empty list)</p>
    }

    const primitives = value.every(isPrimitive)
    if (primitives) {
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
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
              "rounded-lg border border-border/60 bg-muted/30 p-3",
              depth > 0 ? "bg-muted/20" : undefined
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
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
      return <p className="text-sm text-muted-foreground">(empty object)</p>
    }

    return (
      <div className="space-y-2">
        {entries.map(([key, entryValue]) => (
          <div
            key={key}
            className={cn(
              "rounded-md border border-border/60 bg-muted/30 p-3",
              depth > 0 ? "bg-background/70" : undefined
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
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
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30 px-4 py-10 text-foreground md:px-8 gap-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <Card className="overflow-hidden border-none bg-gradient-to-br from-primary/10 via-background to-background shadow-xl ring-1 ring-border/20 ring-offset-2 ring-offset-background">
          <CardHeader className="space-y-4 pb-6">
            <Badge variant="outline" className="w-fit rounded-full uppercase tracking-wide">
              Result snapshot
            </Badge>
            <div className="space-y-2">
              <CardTitle className="text-3xl font-semibold tracking-tight">Automation playback</CardTitle>
              <CardDescription className="max-w-2xl text-base leading-relaxed text-muted-foreground">
                Skim the structured recap without digging through raw notes—the viewer keeps the highlights, risks, and next moves front and center.
              </CardDescription>
              <p className="text-xs uppercase tracking-wide text-muted-foreground/80">
                {payload?.meta?.taskName ?? "Automation output"}
                {payload?.createdAt ? ` · ${formatDate(payload.createdAt)}` : null}
              </p>
              {payload ? (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handleExportMarkdown}
                  >
                    <FileDown className="h-4 w-4" aria-hidden="true" />
                    <span className="text-xs font-semibold uppercase tracking-wide">Download report</span>
                  </Button>
                </div>
              ) : null}
            </div>
          </CardHeader>
        </Card>

        {sections.length === 0 ? (
          <Card className="border-dashed border-border/60 bg-card/80 shadow-md ring-1 ring-border/30 ring-offset-2 ring-offset-background">
            <CardHeader>
              <CardTitle className="text-base">No structured result</CardTitle>
              <CardDescription>
                The automation returned data that doesn&apos;t map to the usual sections.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Re-run the flow or tweak your prompt so it emits structured fields like summary, highlights, or action items.
              </p>
              {payload?.raw ? (
                <>
                  <p className="mt-3 text-xs uppercase tracking-wide text-muted-foreground/70">
                    Raw output
                  </p>
                  <CodeSurface value={payload.raw} className="mt-1" />
                </>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-y-6 gap-x-6 md:grid-cols-2 lg:gap-y-8 lg:gap-x-8">
            {sections.map(({ descriptor, value }) => {
              const allowCopy = descriptor.copyValue?.(value)
              const Icon = descriptor.icon
              return (
                <Card
                  key={descriptor.key}
                  className={cn(
                    "h-full rounded-xl border border-border/70 bg-card/95 shadow-md ring-1 ring-border/30 ring-offset-2 ring-offset-background transition-shadow duration-200 hover:border-primary/40 hover:ring-primary/30 hover:shadow-lg",
                    descriptor.key === "summary" ? "md:col-span-2" : undefined
                  )}
                >
                  <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
                    <div className="flex items-start gap-2">
                      {Icon ? (
                        <span className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                      ) : null}
                      <div>
                        <CardTitle className="text-base font-semibold">
                          {descriptor.title}
                        </CardTitle>
                        {descriptor.description ? (
                          <CardDescription className="text-xs text-muted-foreground">
                            {descriptor.description}
                          </CardDescription>
                        ) : null}
                      </div>
                    </div>
                    {allowCopy ? (
                      <CopyButton
                        target={descriptor.key}
                        copyState={copyState}
                        onCopy={() => copy(descriptor.key, allowCopy)}
                        size="sm"
                      >
                        Copy
                      </CopyButton>
                    ) : null}
                  </CardHeader>
                  <CardContent>{descriptor.render(value)}</CardContent>
                </Card>
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
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
  className?: string
}

function CopyButton({
  target,
  copyState,
  onCopy,
  children,
  variant = "ghost",
  size = "default",
  className
}: CopyButtonProps) {
  const status = copyState.target === target ? copyState.status : "idle"
  const Icon = status === "copied" ? Check : Copy
  const label = status === "copied" ? "Copied" : children

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn("gap-1.5", status === "copied" ? "text-emerald-600" : undefined, className)}
      onClick={onCopy}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
    </Button>
  )
}
