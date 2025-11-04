import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TaskIndicator } from "@/components/ui/task-indicator"
import { cn } from "@/lib/utils"
import { ArrowRight, Bot, CheckCircle2, Clock3, Loader2, XCircle } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import type {
  PromptDiagnostics,
  QuickAction,
  QuickActionWithStatus,
  ReadMetaInfo,
  StepRunStatus,
  WorkflowStepSnapshot
} from "../types"
import type { WorkflowRunRecord } from "@/lib/automation"

export type PopupViewProps = {
  quickActions: QuickActionWithStatus[]
  onQuickAction: (action: QuickAction) => void
  runs: WorkflowRunRecord[]
  activeRuns: number
  debugMode: boolean
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
  selectedRun: WorkflowRunRecord | null
  selectedTimeline: WorkflowStepSnapshot[]
  onViewerOpen: (viewerKey: string) => void
  shouldShowLatestRunPanel: boolean
  successMessage: string | null
  lastError: string | null
  readMetaInfo: ReadMetaInfo
  promptDiagnostics: PromptDiagnostics
  lastOutput: string | null
  onInspectRuns: () => void
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

export function PopupView({
  quickActions,
  onQuickAction,
  runs,
  activeRuns,
  debugMode,
  selectedRunId,
  onSelectRun,
  selectedRun,
  selectedTimeline,
  onViewerOpen,
  shouldShowLatestRunPanel,
  successMessage,
  lastError,
  readMetaInfo,
  promptDiagnostics,
  lastOutput,
  onInspectRuns
}: PopupViewProps) {
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
        <TaskIndicator count={activeRuns} onClick={onInspectRuns} />
      </header>

      <section className="space-y-4 rounded-2xl border bg-card/90 p-4 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">Quick automations</h2>
          <p className="text-xs text-muted-foreground">Fire off a polished update while the coffee is still hot.</p>
        </div>

        <div className="space-y-2">
          {quickActions.map((action) => {
            const { label, description, icon: Icon, className, iconClassName, status } = action
            const isRunning = status.state === "running"
            const queuedCount = status.state === "queued" ? status.queuedCount : 0
            const showQueued = status.state === "queued" && queuedCount > 0
            const showFailed = status.state === "failed"

            return (
              <Button
                key={label}
                variant="outline"
                size="lg"
                className={cn(
                  "group h-auto w-full flex-col items-start justify-start gap-2 rounded-xl border border-border/70 bg-background/80 px-4 py-3 text-left",
                  "transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm focus-visible:ring-primary/40",
                  isRunning ? "border-primary/60 ring-1 ring-primary/30" : null,
                  className
                )}
                onClick={() => onQuickAction(action)}
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
                {isRunning ? (
                  <span className="text-[10px] uppercase tracking-wide text-primary">Running…</span>
                ) : showQueued ? (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Queued ({queuedCount})
                  </span>
                ) : showFailed ? (
                  <span className="text-[10px] uppercase tracking-wide text-destructive">Last run failed</span>
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
                  className={cn("h-8 rounded-full px-3 text-xs", isSelected ? "ring-1 ring-primary" : undefined)}
                  onClick={() => onSelectRun(run.id)}
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
                  {Math.max(0, selectedRun.finishedAt - (selectedRun.startedAt ?? selectedRun.createdAt))}
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
                    <div key={step.key} className="rounded-xl border border-border/70 bg-background/80 p-3">
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
                          {step.error ? <p className="text-[11px] text-destructive">{step.error}</p> : null}
                        </div>
                        {viewerKey ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => onViewerOpen(viewerKey)}
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
                          <summary className="cursor-pointer text-muted-foreground/80">Debug details</summary>
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

      {shouldShowLatestRunPanel ? (
        <Card className="rounded-2xl border bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Latest run output</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {successMessage ? <p className="text-xs font-medium text-primary">{successMessage}</p> : null}
            {lastError ? <p className="text-xs text-destructive">{lastError}</p> : null}
            {readMetaInfo ? (
              <div className="rounded-md border border-dashed border-muted/50 bg-muted/20 p-2 text-[11px] leading-relaxed text-muted-foreground">
                {readMetaInfo.title ? <p className="font-medium text-foreground">{readMetaInfo.title}</p> : null}
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
                    <summary className="cursor-pointer text-muted-foreground/70">Debug trace</summary>
                    <pre className="mt-1 max-h-32 overflow-auto rounded bg-background/60 p-2 text-[10px] leading-snug text-muted-foreground">
                      {readMetaInfo.debug.join("\n")}
                    </pre>
                  </details>
                ) : null}
              </div>
            ) : null}
            {promptDiagnostics?.fallbackUsed ? (
              <p className="text-[11px] text-amber-600">
                Prompt API fallback triggered
                {promptDiagnostics.fallbackReason ? ` (${promptDiagnostics.fallbackReason})` : ""}
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
