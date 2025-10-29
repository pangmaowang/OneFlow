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
import { listArtifacts } from "@/lib/storage"
import { openAutomationResultViewer } from "@/lib/viewer"
import { cn } from "@/lib/utils"
import { ArrowRight, BookOpen, Bot, Cpu, PlusCircle, Sparkles } from "lucide-react"
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

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "Capture this page",
    description: "Clean up the active tab and preview the extracted text.",
    icon: BookOpen,
    className: "border-primary/30 bg-primary/10 text-primary shadow-sm hover:bg-primary/15",
    iconClassName: "text-primary",
    presetId: "page-capture"
  },
  {
    label: "Daily dev recap",
    description: "Summarize commits, blockers, and upcoming priorities in seconds.",
    icon: Cpu,
    className: "hover:border-primary/40 hover:bg-primary/10",
    iconClassName: "text-primary",
    presetId: "daily-dev"
  },
  {
    label: "Add custom flow",
    description: "Stack prompts, tools, and approvals to craft your own automation. Coming soon.",
    icon: PlusCircle,
    className:
      "border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/40 hover:text-primary",
    iconClassName: "text-muted-foreground"
  },
  {
    label: "Prompt API demo",
    description: "Call Gemini Nano via the Prompt API and inspect the JSON output.",
    icon: Sparkles,
    className: "hover:border-purple-300/70 hover:bg-purple-200/20",
    iconClassName: "text-purple-500",
    presetId: "prompt-api-demo",
    initialInput: `Ticket: "Payment webhook retries"\nContext: Partial migration to v2 queue. QA noticed duplicate refund emails on retries. ACs mention graceful back-off and idempotent updates but do not call out legacy cron job that may still fire. Logs: shard-3 reports occasional 409 conflict when retry > 3 attempts.\nRequested by: Growth ops. Deadline: end of week.`
  }
]

const STORAGE_TEST_TASK: TaskDefinition = {
  id: "storage-test",
  name: "Storage action test",
  steps: [
    {
      id: "persistSampleResult",
      type: "store-artifact",
      description: "Persist a sample prompt output for debugging.",
      config: {
        artifactType: "prompt-result",
        metadata: {
          source: "popup-debug"
        },
        tags: ["debug", "popup"],
        skipWhenEmpty: true
      }
    }
  ]
}

const STORAGE_TEST_SAMPLE = JSON.stringify(
  {
    summary: "Wrapped the payment webhook retry migration and monitored rollout",
    suggestedClarifications: [
      "Confirm legacy cron job disablement before enabling retries",
      "Validate alert coverage for duplicate refund detection"
    ],
    riskLevel: "medium",
    testPlan: [
      "Simulate retry burst with idempotency keys",
      "Verify audit logs only include one refund per user",
      "Ensure dashboards show retry latency within SLA"
    ]
  },
  null,
  2
)

function IndexPopup() {
  const manager = useMemo(() => new WorkflowManager(), [])
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([])
  const [storageTestStatus, setStorageTestStatus] = useState<string | null>(null)

  useEffect(() => manager.subscribe(setRuns), [manager])

  const quickActions = useMemo(() => QUICK_ACTIONS, [])

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

      const runOptions: TaskRunOptions = {}
      if (action.initialInput !== undefined) {
        runOptions.initialInput = action.initialInput
      }

      manager.enqueue(
        preset,
        Object.keys(runOptions).length > 0 ? runOptions : undefined
      )
    },
    [manager]
  )

  const handleStorageTestSave = useCallback(() => {
    setStorageTestStatus("Queued storage test task…")
    manager.enqueue(STORAGE_TEST_TASK, {
      initialInput: STORAGE_TEST_SAMPLE
    })
  }, [manager])

  const handleStorageTestInspect = useCallback(async () => {
    try {
      const artifacts = await listArtifacts({ limit: 5, order: "desc" })

      const tableRows = artifacts.map((artifact) => {
        const raw = artifact.payload.raw
        const preview = typeof raw === "string" ? raw.slice(0, 120) : ""
        return {
          id: artifact.id,
          type: artifact.type,
          createdAt: new Date(artifact.createdAt).toLocaleString(),
          tags: artifact.tags?.join(", ") ?? "—",
          metadata: artifact.metadata ?? {},
          payloadPreview: preview.length === raw.length ? preview : `${preview}…`
        }
      })

      console.table(tableRows)
      if (artifacts.length > 0) {
        console.dir(artifacts, { depth: null })
      }
      setStorageTestStatus(
        `Logged ${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"} to the console.`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("Failed to read artifacts", error)
      setStorageTestStatus(`Failed to read artifacts: ${message}`)
    }
  }, [])

  return (
    <div className="w-[380px] max-w-full space-y-4 p-4">
      <header className="flex items-center justify-between rounded-2xl border bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 shadow">
            <Bot className="h-5 w-5 text-primary-foreground" />
          </span>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">Auto Boring</p>
            <p className="text-xs text-muted-foreground">Automate the work you&apos;d rather skip.</p>
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
            Launch a ready-made routine or sketch the automation you have in mind.
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

      <section className="space-y-3 rounded-2xl border border-dashed border-muted/50 bg-card/70 p-4 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">Storage action debug</h2>
          <p className="text-xs text-muted-foreground">
            Use these helpers while developing to persist a sample prompt result and inspect recent
            entries.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={handleStorageTestSave} className="sm:flex-1">
            Store sample artifact
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleStorageTestInspect}
            className="sm:flex-1"
          >
            Log recent artifacts
          </Button>
        </div>
        {storageTestStatus ? (
          <p className="text-[11px] text-muted-foreground">{storageTestStatus}</p>
        ) : null}
      </section>

      {lastOutput || lastError ? (
        <Card className="rounded-2xl border bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Latest run output</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
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
