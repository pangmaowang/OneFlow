import { useEffect, useMemo, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { Check, CircleHelp, Copy, FileText, ListChecks, Shield } from "lucide-react"

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
    render: (value) =>
      Array.isArray(value) && value.length > 0 ? (
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          {value.filter((item): item is string => typeof item === "string").map((item, index) => (
            <li key={`${item}_${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No clarifications provided.</p>
      ),
    copyValue: (value) =>
      Array.isArray(value) && value.length > 0
        ? value.filter((item): item is string => typeof item === "string").join("\n")
        : null
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
    render: (value) =>
      Array.isArray(value) && value.length > 0 ? (
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          {value.filter((item): item is string => typeof item === "string").map((item, index) => (
            <li key={`${item}_${index}`}>{item}</li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No test plan suggestions available.</p>
      ),
    copyValue: (value) =>
      Array.isArray(value) && value.length > 0
        ? value.filter((item): item is string => typeof item === "string").join("\n")
        : null
  }
]

function buildSections(parsed: unknown) {
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
        title: key,
        description: undefined,
        icon: undefined,
        render: (renderValue: unknown) => (
          <CodeSurface
            value={
              typeof renderValue === "string"
                ? renderValue
                : JSON.stringify(renderValue, null, 2)
            }
            className="max-h-60"
          />
        ),
        copyValue: (copyValue: unknown) =>
          typeof copyValue === "string" ? copyValue : JSON.stringify(copyValue, null, 2)
      } satisfies SectionDescriptor,
      value
    }))

  return [...recognized, ...extras]
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

export default function PromptViewer() {
  const { state, payload, errorMessage } = useViewerData()
  const { copyState, copy } = useCopy()

  const sections = useMemo(() => buildSections(payload?.parsed), [payload])

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
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30 px-4 py-10 text-foreground md:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <Card className="overflow-hidden border-none bg-gradient-to-br from-primary/10 via-background to-background shadow-xl">
          <CardHeader className="space-y-4 pb-6">
            <Badge variant="outline" className="w-fit rounded-full uppercase tracking-wide">
              Automation result
            </Badge>
            <div className="space-y-2">
              <CardTitle className="text-3xl font-semibold tracking-tight">Prompt result</CardTitle>
              <CardDescription className="max-w-2xl text-base leading-relaxed text-muted-foreground">
                This viewer highlights the structured response generated by Auto Boring&apos;s Prompt API action.
                Review the cards below for the key insights and recommendations returned for your latest run.
              </CardDescription>
              <p className="text-xs uppercase tracking-wide text-muted-foreground/80">
                {payload?.meta?.taskName ?? "Automation output"}
                {payload?.createdAt ? ` · ${formatDate(payload.createdAt)}` : null}
              </p>
            </div>
          </CardHeader>
        </Card>

        {sections.length === 0 ? (
          <Card className="border-dashed border-border/60 bg-card/80">
            <CardHeader>
              <CardTitle className="text-base">No structured result</CardTitle>
              <CardDescription>
                The automation returned data that does not map to known sections.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Re-run the flow or adjust your prompt to produce structured fields such as summary, clarifications, or test plan.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {sections.map(({ descriptor, value }) => {
              const allowCopy = descriptor.copyValue?.(value)
              const Icon = descriptor.icon
              return (
                <Card
                  key={descriptor.key}
                  className={cn(
                    "border border-border/60 bg-card/90 shadow-sm transition hover:border-primary/30 hover:shadow",
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
