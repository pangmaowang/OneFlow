import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TaskIndicator } from "@/components/ui/task-indicator"
import "./style.css"

import {
  PRESET_REGISTRY,
  WorkflowManager,
  type PresetId,
  type TaskDefinition,
  type TaskRunOptions,
  type WorkflowRunRecord
} from "@/lib/automation"
import { openStashedAutomationResult } from "@/lib/viewer"
import { cn } from "@/lib/utils"
import {
  ArrowRight,
  Bot,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Feather,
  Loader2,
  NotebookPen,
  PlusCircle,
  Sparkles,
  XCircle
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

type QuickAction = {
  label: string
  description: string
  icon: LucideIcon
  className?: string
  iconClassName?: string
  presetId?: PresetId
  initialInput?: unknown
}

type StepRunStatus = "pending" | "running" | "succeeded" | "failed"

type WorkflowStepSnapshot = {
  key: string
  index: number
  stepId?: string
  type: string
  description?: string
  status: StepRunStatus
  outputPreview?: string | null
  meta?: Record<string, unknown>
  error?: string | null
  startedAt?: number
  finishedAt?: number
}

type WorkflowStepPatch = {
  status?: StepRunStatus
  outputPreview?: string | null
  meta?: Record<string, unknown> | null
  error?: string | null
  startedAt?: number
  finishedAt?: number
}

const STEP_STATUS_META: Record<StepRunStatus, { label: string; className: string; icon: LucideIcon }> = {
  pending: {
    label: "Pending",
    className: "text-muted-foreground",
    icon: Clock3
  },
  running: {
    label: "Running",
    className: "text-primary",
    icon: Loader2
  },
  succeeded: {
    label: "Succeeded",
    className: "text-emerald-600",
    icon: CheckCircle2
  },
  failed: {
    label: "Failed",
    className: "text-destructive",
    icon: XCircle
  }
}

const RUN_STATUS_META: Record<WorkflowRunRecord["status"], { label: string; className: string }> = {
  queued: {
    label: "Queued",
    className: "text-muted-foreground"
  },
  running: {
    label: "Running",
    className: "text-primary"
  },
  succeeded: {
    label: "Succeeded",
    className: "text-emerald-600"
  },
  failed: {
    label: "Failed",
    className: "text-destructive"
  },
  cancelled: {
    label: "Cancelled",
    className: "text-muted-foreground"
  }
}

const PREVIEW_LIMIT = 320
const MAX_DEBUG_ENTRIES = 8

function resolveDebugEnvFlag() {
  const processEnv =
    typeof process !== "undefined" &&
    (process.env as Record<string, string | undefined> | undefined)

  if (processEnv?.PLASMO_PUBLIC_AUTOMATION_DEBUG === "true") {
    return true
  }

  try {
    const metaEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env
    if (metaEnv?.PLASMO_PUBLIC_AUTOMATION_DEBUG === "true") {
      return true
    }
  } catch (_error) {
    // no-op
  }

  return false
}

function initializeStepSnapshots(task: TaskDefinition): WorkflowStepSnapshot[] {
  return task.steps.map((step, index) => ({
    key: step.id ?? `${step.type}-${index}`,
    index,
    stepId: step.id,
    type: step.type,
    description: step.description,
    status: "pending"
  }))
}

function formatOutputPreview(output: unknown): string | null {
  if (output == null) {
    return null
  }

  if (typeof output === "string") {
    const trimmed = output.trim()
    if (!trimmed) {
      return null
    }
    return trimmed.length > PREVIEW_LIMIT ? `${trimmed.slice(0, PREVIEW_LIMIT)}…` : trimmed
  }

  try {
    const serialized = JSON.stringify(output, null, 2)
    return serialized.length > PREVIEW_LIMIT ? `${serialized.slice(0, PREVIEW_LIMIT)}…` : serialized
  } catch (_error) {
    return String(output)
  }
}

function summarizeStepMeta(meta: unknown, debugMode: boolean): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object") {
    return null
  }

  const record = meta as Record<string, unknown>
  const summary: Record<string, unknown> = {}

  if (typeof record.viewerKey === "string") {
    summary.viewerKey = record.viewerKey
  }
  if (record.fallbackUsed) {
    summary.fallbackUsed = true
    if (typeof record.fallbackReason === "string") {
      summary.fallbackReason = record.fallbackReason
    }
  }
  if (typeof record.usedPromptApi === "boolean") {
    summary.usedPromptApi = record.usedPromptApi
  }
  if (typeof record.rawPreview === "string" && record.rawPreview) {
    summary.rawPreview = record.rawPreview
  }
  if (typeof record.normalizedPreview === "string" && record.normalizedPreview) {
    summary.normalizedPreview = record.normalizedPreview
  }
  if (typeof record.artifactId === "string") {
    summary.artifactId = record.artifactId
  }
  if (typeof record.artifactType === "string") {
    summary.artifactType = record.artifactType
  }
  if (typeof record.viewerAvailable === "boolean") {
    summary.viewerAvailable = record.viewerAvailable
  }
  if (typeof record.rawLength === "number") {
    summary.rawLength = record.rawLength
  }
  if (record.parsed) {
    summary.parsed = true
    if (typeof record.parsedSource === "string") {
      summary.parsedSource = record.parsedSource
    }
  } else if (typeof record.parsed === "boolean") {
    summary.parsed = false
  }
  if (Array.isArray(record.normalizedFields) && record.normalizedFields.length > 0) {
    summary.normalizedFields = record.normalizedFields
  }

  if (debugMode) {
    if (Array.isArray(record.debug) && record.debug.length > 0) {
      summary.debug = record.debug.slice(-MAX_DEBUG_ENTRIES)
    }
    if (typeof record.promptLength === "number") {
      summary.promptLength = record.promptLength
    }
    if (typeof record.resultLength === "number") {
      summary.resultLength = record.resultLength
    }
    if (record.expectsJson) {
      summary.expectsJson = record.expectsJson
    }
  }

  return Object.keys(summary).length > 0 ? summary : null
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "Daily dev debrief",
    description: "Digest the ticket, capture what matters, and spin it into a shine-worthy update.",
    icon: Sparkles,
    className: "hover:border-purple-300/70 hover:bg-purple-200/20",
    iconClassName: "text-purple-500",
    presetId: "daily-dev"
  },
  {
    label: "Weekly highlight reel",
    description: "Roll up the week’s recaps into a brag-worthy briefing in one click.",
    icon: CalendarRange,
    className: "border-amber-300/60 bg-amber-200/15 text-amber-700 hover:bg-amber-200/25",
    iconClassName: "text-amber-500",
    presetId: "weekly-summary"
  },
  {
    label: "Blog research kit",
    description: "Clip any page and capture summary, tags, insights, technical angles, and source links for your blog.",
    icon: Feather,
    className: "border-sky-300/60 bg-sky-200/15 text-sky-800 hover:bg-sky-200/20",
    iconClassName: "text-sky-500",
    presetId: "blog-draft"
  },
  {
    label: "Blog weekly digest",
    description: "Blend the week’s research notes into an editorial brief with top tags, spotlights, and next angles.",
    icon: NotebookPen,
    className: "border-indigo-300/60 bg-indigo-200/15 text-indigo-800 hover:bg-indigo-200/20",
    iconClassName: "text-indigo-500",
    presetId: "blog-weekly"
  },
  {
    label: "Add custom flow",
    description: "Design your dream workflow with prompts, tools, and approvals—coming soon.",
    icon: PlusCircle,
    className:
      "border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/40 hover:text-primary",
    iconClassName: "text-muted-foreground"
  }
]

function IndexPopup() {
  const manager = useMemo(() => new WorkflowManager(), [])
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([])
  const [stepStateByRun, setStepStateByRun] = useState<Record<string, WorkflowStepSnapshot[]>>({})
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const debugMode = useMemo(() => {
    const envFlag = resolveDebugEnvFlag()
    const runtimeFlag =
      typeof window !== "undefined" &&
      Boolean((window as { __AUTO_BORING_DEBUG__?: boolean }).__AUTO_BORING_DEBUG__)
    return envFlag || runtimeFlag
  }, [])

  useEffect(() => manager.subscribe(setRuns), [manager])

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId(null)
      return
    }

    if (selectedRunId && runs.some((run) => run.id === selectedRunId)) {
      return
    }

    setSelectedRunId(runs[0]?.id ?? null)
  }, [runs, selectedRunId])

  const quickActions = useMemo(() => QUICK_ACTIONS, [])

  const registerRunTimeline = useCallback((runId: string, task: TaskDefinition) => {
    setStepStateByRun((previous) => {
      if (previous[runId]) {
        return previous
      }
      return {
        ...previous,
        [runId]: initializeStepSnapshots(task)
      }
    })
  }, [])

  const patchStepState = useCallback(
    (runId: string, stepIndex: number, patch: WorkflowStepPatch) => {
      setStepStateByRun((previous) => {
        const steps = previous[runId]
        if (!steps || !steps[stepIndex]) {
          return previous
        }

        const nextSteps = steps.slice()
        const current = nextSteps[stepIndex]
        const { meta, ...rest } = patch
        nextSteps[stepIndex] = {
          ...current,
          ...rest,
          meta: meta === undefined ? current.meta : meta ?? undefined
        }

        return {
          ...previous,
          [runId]: nextSteps
        }
      })
    },
    []
  )

  useEffect(() => {
    setStepStateByRun((previous) => {
      let changed = false
      const next = { ...previous }

      for (const run of runs) {
        if (!run.result || next[run.id]) {
          continue
        }

        changed = true
        next[run.id] = run.result.steps.map((entry, index) => ({
          key: entry.step.id ?? `${entry.step.type}-${index}`,
          index,
          stepId: entry.step.id,
          type: entry.step.type,
          description: entry.step.description,
          status: entry.result.success ? "succeeded" : "failed",
          outputPreview: formatOutputPreview(entry.result.output),
          meta: summarizeStepMeta(entry.result.meta, debugMode) ?? undefined,
          error: entry.result.success
            ? null
            : entry.result.error?.message ?? "Action failed"
        }))
      }

      return changed ? next : previous
    })
  }, [debugMode, runs])

  const createInstrumentedRunOptions = useCallback(
    (task: TaskDefinition, overrides: TaskRunOptions = {}) => {
      const runState = { id: "" }
      const baseOnStepStart = overrides.onStepStart
      const baseOnStepComplete = overrides.onStepComplete
      const baseOnError = overrides.onError

      const runOptions: TaskRunOptions = {
        ...overrides,
        onStepStart(step, index) {
          if (runState.id) {
            patchStepState(runState.id, index, {
              status: "running",
              startedAt: Date.now(),
              error: null,
              outputPreview: null
            })
          }
          baseOnStepStart?.(step, index)
        },
        onStepComplete(step, result, index) {
          if (runState.id) {
            const outputPreview = formatOutputPreview(result.output)
            const summarizedMeta = summarizeStepMeta(result.meta, debugMode)
            patchStepState(runState.id, index, {
              status: result.success ? "succeeded" : "failed",
              finishedAt: Date.now(),
              outputPreview,
              meta: summarizedMeta,
              error: result.success
                ? null
                : result.error?.message ?? "Action failed"
            })
          }
          baseOnStepComplete?.(step, result, index)
        },
        onError(step, error, index) {
          if (runState.id) {
            patchStepState(runState.id, index, {
              status: "failed",
              finishedAt: Date.now(),
              error: error.message
            })
          }
          baseOnError?.(step, error, index)
        }
      }

      const assignRunId = (runId: string) => {
        runState.id = runId
        registerRunTimeline(runId, task)
        setSelectedRunId(runId)
      }

      return { runOptions, assignRunId }
    },
    [debugMode, patchStepState, registerRunTimeline]
  )

  const handleViewerOpen = useCallback((viewerKey: string) => {
    try {
      openStashedAutomationResult(viewerKey)
    } catch (error) {
      console.error("Unable to open viewer", error)
    }
  }, [])

  const activeRuns = useMemo(
    () =>
      runs.filter((run) => run.status === "running" || run.status === "queued").length,
    [runs]
  )

  const latestSuccess = useMemo(
    () => runs.find((run) => run.status === "succeeded" && run.result?.success),
    [runs]
  )

  const latestFailure = useMemo(
    () => runs.find((run) => run.status === "failed"),
    [runs]
  )

  const lastOutput = useMemo(() => {
    if (!latestSuccess) {
      return null
    }
    const outputValue = latestSuccess.result?.output
    if (outputValue == null) {
      return "No output produced"
    }
    return typeof outputValue === "string"
      ? outputValue
      : JSON.stringify(outputValue, null, 2)
  }, [latestSuccess])

  const lastError = useMemo(() => {
    if (!latestFailure) {
      return null
    }
    return (
      latestFailure.error?.message ?? latestFailure.result?.error?.message ?? "Automation failed"
    )
  }, [latestFailure])

  const selectedRun = useMemo(
    () => (selectedRunId ? runs.find((run) => run.id === selectedRunId) ?? null : null),
    [runs, selectedRunId]
  )

  const selectedTimeline = useMemo(() => {
    if (!selectedRunId) {
      return [] as WorkflowStepSnapshot[]
    }
    return stepStateByRun[selectedRunId] ?? []
  }, [selectedRunId, stepStateByRun])

  const latestReadMeta = useMemo(() => {
    const readStep = latestSuccess?.result?.steps.find((entry) => entry.step.type === "read-page")
    const meta = readStep?.result.meta
    return meta && typeof meta === "object" ? (meta as Record<string, unknown>) : null
  }, [latestSuccess])

  const readMetaInfo = useMemo(() => {
    if (!latestReadMeta) {
      return null
    }

    const url = typeof latestReadMeta.url === "string" ? latestReadMeta.url : undefined
    const title = typeof latestReadMeta.title === "string" ? latestReadMeta.title : undefined
    const length = typeof latestReadMeta.length === "number" ? latestReadMeta.length : undefined
    const truncated = Boolean(latestReadMeta.truncated)
    const fallbackUsed = Boolean(latestReadMeta.fallbackUsed)
    const debug = Array.isArray(latestReadMeta.debug)
      ? (latestReadMeta.debug as unknown[]).map(String)
      : undefined

    return {
      url,
      title,
      length,
      truncated,
      fallbackUsed,
      debug
    }
  }, [latestReadMeta])

  const successMessage = useMemo(() => {
    if (!latestSuccess?.result) {
      return null
    }

    const storeStep = latestSuccess.result.steps.find((entry) => entry.step.type === "store-artifact")
    const storeMeta = storeStep?.result.meta as Record<string, unknown> | undefined
    const artifactId = typeof storeMeta?.artifactId === "string" ? storeMeta.artifactId : undefined
    const artifactType = typeof storeMeta?.artifactType === "string" ? storeMeta.artifactType : undefined

    if (!artifactId && !artifactType) {
      return null
    }

    const runLabel = latestSuccess.taskName ?? latestSuccess.taskId
    const typeLabel = artifactType ?? "artifact"
    const idSuffix = artifactId ? ` (#${artifactId.slice(0, 6)})` : ""

    return `${runLabel} stored ${typeLabel}${idSuffix}`
  }, [latestSuccess])

  const promptDiagnostics = useMemo(() => {
    if (!latestSuccess?.result) {
      return null
    }

    const promptStep = latestSuccess.result.steps.find(
      (entry) => entry.step.type === "structured-prompt"
    )
    const meta = promptStep?.result.meta as Record<string, unknown> | undefined
    if (!meta) {
      return null
    }

    const usedPromptApi = Boolean(meta.usedPromptApi)
    const fallbackUsed = Boolean(meta.fallbackUsed)
    const fallbackReason = typeof meta.fallbackReason === "string" ? meta.fallbackReason : undefined
    const viewerKey = typeof meta.viewerKey === "string" ? meta.viewerKey : undefined
    const viewerAvailable = Boolean(meta.viewerAvailable)

    if (!usedPromptApi && !fallbackUsed && !viewerKey) {
      return null
    }

    return {
      usedPromptApi,
      fallbackUsed,
      fallbackReason,
      viewerKey,
      viewerAvailable
    }
  }, [latestSuccess])

  const handleRunPreset = useCallback(
    (action: QuickAction) => {
      if (!action.presetId) {
        return
      }

      const preset = PRESET_REGISTRY[action.presetId]
      if (!preset) {
        console.warn(`Preset ${action.presetId} is not yet implemented.`)
        return
      }

      const baseOptions: TaskRunOptions =
        action.initialInput !== undefined ? { initialInput: action.initialInput } : {}

      const { runOptions, assignRunId } = createInstrumentedRunOptions(preset, baseOptions)
      const runId = manager.enqueue(preset, runOptions)
      assignRunId(runId)
    },
    [createInstrumentedRunOptions, manager]
  )

  return (
    <div className="w-[380px] max-w-full space-y-4 p-4">
  <header className="flex items-center justify-between rounded-2xl border bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 shadow">
            <Bot className="h-5 w-5 text-primary-foreground" />
          </span>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">OneFlow</p>
            <p className="text-xs text-muted-foreground">Automate tasks, content, and progress in a single click.</p>
          </div>
        </div>
        <TaskIndicator
          count={activeRuns}
          onClick={() => {
            console.info("Automation runs", runs)
          }}
        />
      </header>

      <section className="space-y-4 rounded-2xl border bg-card/90 p-4 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">Quick automations</h2>
          <p className="text-xs text-muted-foreground">
            Fire off a polished update while the coffee is still hot.
          </p>
        </div>

        <div className="space-y-2">
          {quickActions.map((action) => {
            const { label, description, icon: Icon, className, iconClassName, presetId } = action

            const runsForPreset = presetId
              ? runs.filter((run) => run.taskId === presetId)
              : []
            const activeRun = runsForPreset.find((run) => run.status === "running")
            const queuedCount = runsForPreset.filter((run) => run.status === "queued").length
            const failedRun = runsForPreset.find((run) => run.status === "failed")

            return (
              <Button
                key={label}
                variant="outline"
                size="lg"
                className={cn(
                  "group h-auto w-full flex-col items-start justify-start gap-2 rounded-xl border border-border/70 bg-background/80 px-4 py-3 text-left",
                  "transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm focus-visible:ring-primary/40",
                  activeRun ? "border-primary/60 ring-1 ring-primary/30" : null,
                  className
                )}
                onClick={() => handleRunPreset(action)}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon className={cn("h-4 w-4", iconClassName ?? "text-primary")} />
                    {label}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                </div>
                <span className="w-full text-xs text-muted-foreground line-clamp-2" title={description}>
                  {description}
                </span>
                {activeRun ? (
                  <span className="text-[10px] uppercase tracking-wide text-primary">Running…</span>
                ) : queuedCount > 0 ? (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Queued ({queuedCount})
                  </span>
                ) : failedRun ? (
                  <span className="text-[10px] uppercase tracking-wide text-destructive">
                    Last run failed
                  </span>
                ) : null}
              </Button>
            )
          })}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border bg-card/80 p-4 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">Workflow timeline</h2>
          <p className="text-xs text-muted-foreground">
            {debugMode
              ? "Peek at every stage, payload, and metadata crumb while you debug."
              : "See each step check in as your automation does the busywork."}
          </p>
        </div>

        {runs.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {runs.slice(0, 4).map((run) => {
              const statusMeta = RUN_STATUS_META[run.status]
              const isSelected = run.id === selectedRunId
              const runLabel = run.taskName ?? run.taskId ?? "Untitled run"
              return (
                <Button
                  key={run.id}
                  type="button"
                  size="sm"
                  variant={isSelected ? "secondary" : "ghost"}
                  className={cn(
                    "h-8 rounded-full px-3 text-xs",
                    isSelected ? "ring-1 ring-primary" : undefined
                  )}
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <span className="font-medium">{runLabel}</span>
                  <span className={cn("ml-2 text-[10px] uppercase", statusMeta.className)}>
                    {statusMeta.label}
                  </span>
                </Button>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Launch a run to watch the automation play-by-play fill in here.
          </p>
        )}

        {selectedRun ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>Started {new Date(selectedRun.createdAt).toLocaleTimeString()}</span>
              {selectedRun.status !== "running" ? (
                <span>
                  Status:{" "}
                  <span className={cn("font-medium", RUN_STATUS_META[selectedRun.status].className)}>
                    {RUN_STATUS_META[selectedRun.status].label}
                  </span>
                </span>
              ) : null}
              {selectedRun.finishedAt ? (
                <span>
                  Duration:{" "}
                  {Math.max(
                    0,
                    selectedRun.finishedAt - (selectedRun.startedAt ?? selectedRun.createdAt)
                  )}
                  ms
                </span>
              ) : null}
            </div>

            <div className="space-y-2">
              {selectedTimeline.length > 0 ? (
                selectedTimeline.map((step) => {
                  const statusMeta = STEP_STATUS_META[step.status]
                  const Icon = statusMeta.icon
                  const viewerKey =
                    step.meta && typeof step.meta.viewerKey === "string"
                      ? (step.meta.viewerKey as string)
                      : undefined
                  const showPreview = Boolean(step.outputPreview) && (debugMode || step.status === "failed")
                  const showMetaDetails = debugMode && step.meta

                  return (
                    <div
                      key={step.key}
                      className="rounded-xl border border-border/70 bg-background/80 p-3"
                    >
                      <div className="flex items-start gap-3">
                        <span className={cn("mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-muted/80", statusMeta.className)}>
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <div className="flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">
                              {step.description ?? `Step ${step.index + 1}`}
                            </p>
                            <span className={cn("text-[10px] uppercase", statusMeta.className)}>
                              {statusMeta.label}
                            </span>
                          </div>
                          {step.error ? (
                            <p className="text-[11px] text-destructive">{step.error}</p>
                          ) : null}
                        </div>
                        {viewerKey ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => handleViewerOpen(viewerKey)}
                          >
                            View result
                          </Button>
                        ) : null}
                      </div>

                      {showPreview ? (
                        <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-muted/40 p-2 text-[11px] leading-snug text-muted-foreground">
                          {step.outputPreview}
                        </pre>
                      ) : null}

                      {showMetaDetails ? (
                        <details className="mt-2 text-[11px]">
                          <summary className="cursor-pointer text-muted-foreground/80">
                            Debug details
                          </summary>
                          <pre className="mt-1 max-h-48 overflow-auto rounded bg-background/80 p-2 leading-snug text-muted-foreground">
                            {JSON.stringify(step.meta, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  )
                })
              ) : (
                <p className="text-xs text-muted-foreground">
                  Step updates will roll in as soon as the workflow is underway.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </section>

      {lastOutput || lastError ? (
        <Card className="rounded-2xl border bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Latest run output</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {successMessage ? (
              <p className="text-xs font-medium text-primary">{successMessage}</p>
            ) : null}
            {lastError ? (
              <p className="text-xs text-destructive">{lastError}</p>
            ) : null}
            {readMetaInfo ? (
              <div className="rounded-md border border-dashed border-muted/50 bg-muted/20 p-2 text-[11px] leading-relaxed text-muted-foreground">
                {readMetaInfo.title ? (
                  <p className="font-medium text-foreground">{readMetaInfo.title}</p>
                ) : null}
                {readMetaInfo.url ? (
                  <p className="truncate">
                    <span className="text-muted-foreground/80">Source:</span>{" "}
                    <a
                      className="text-foreground underline decoration-dotted underline-offset-2"
                      href={readMetaInfo.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {readMetaInfo.url}
                    </a>
                  </p>
                ) : null}
                <p>
                  Characters: {readMetaInfo.length ?? "—"}
                  {readMetaInfo.truncated ? " (trimmed)" : ""}
                  {readMetaInfo.fallbackUsed ? " • fallback" : ""}
                </p>
                {readMetaInfo.debug && readMetaInfo.debug.length > 0 ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted-foreground/70">
                      Debug trace
                    </summary>
                    <pre className="mt-1 max-h-32 overflow-auto rounded bg-background/60 p-2 text-[10px] leading-snug text-muted-foreground">
                      {readMetaInfo.debug.join("\n")}
                    </pre>
                  </details>
                ) : null}
              </div>
            ) : null}
          {promptDiagnostics?.fallbackUsed ? (
            <p className="text-[11px] text-amber-600">
              Prompt API fallback triggered{promptDiagnostics.fallbackReason ? ` (${promptDiagnostics.fallbackReason})` : ""}
            </p>
          ) : null}
            {lastOutput ? (
              <pre className="max-h-48 overflow-auto rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                {lastOutput}
              </pre>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

export default IndexPopup
