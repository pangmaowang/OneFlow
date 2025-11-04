import { useCallback, useEffect, useMemo, useState } from "react"

import {
  PRESET_REGISTRY,
  WorkflowManager,
  type TaskDefinition,
  type TaskRunOptions,
  type WorkflowRunRecord
} from "@/lib/automation"
import { openStashedAutomationResult } from "@/lib/viewer"

import { QUICK_ACTIONS } from "../config"
import {
  formatOutputPreview,
  initializeStepSnapshots,
  resolveDebugEnvFlag,
  summarizeStepMeta
} from "../utils/popup-utils"
import type {
  PromptDiagnostics,
  QuickAction,
  QuickActionStatus,
  QuickActionWithStatus,
  ReadMetaInfo,
  WorkflowStepPatch,
  WorkflowStepSnapshot
} from "../types"
import type { PopupViewProps } from "../components/popup-view"

export function usePopupLogic(): PopupViewProps {
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

  useEffect(() => {
    const unsubscribe = manager.subscribe(setRuns)
    return unsubscribe
  }, [manager])

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

  const quickActionsWithStatus = useMemo<QuickActionWithStatus[]>(() => {
    return quickActions.map((action) => {
      if (!action.presetId) {
        const status: QuickActionStatus = { state: "idle" }
        return { ...action, status }
      }

      const runsForPreset = runs.filter((run) => run.taskId === action.presetId)
      const isRunning = runsForPreset.some((run) => run.status === "running")
      const queuedCount = runsForPreset.filter((run) => run.status === "queued").length
      const hasFailed = runsForPreset.some((run) => run.status === "failed")

      let status: QuickActionStatus
      if (isRunning) {
        status = { state: "running" }
      } else if (queuedCount > 0) {
        status = { state: "queued", queuedCount }
      } else if (hasFailed) {
        status = { state: "failed" }
      } else {
        status = { state: "idle" }
      }

      return {
        ...action,
        status
      }
    })
  }, [quickActions, runs])

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
              error: result.success ? null : result.error?.message ?? "Action failed"
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
    () => runs.filter((run) => run.status === "running" || run.status === "queued").length,
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
    if (outputValue === null || outputValue === undefined) {
      return null
    }

    if (typeof outputValue === "string") {
      const trimmed = outputValue.trim()
      return trimmed.length > 0 ? trimmed : null
    }

    try {
      return JSON.stringify(outputValue, null, 2)
    } catch (_error) {
      return String(outputValue)
    }
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

  const readMetaInfo: ReadMetaInfo = useMemo(() => {
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

  const promptDiagnostics: PromptDiagnostics = useMemo(() => {
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

  const shouldShowLatestRunPanel = debugMode && Boolean(lastOutput || lastError)

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

  const handleSelectRun = useCallback((runId: string) => {
    setSelectedRunId(runId)
  }, [])

  const handleInspectRuns = useCallback(() => {
    console.info("Automation runs", runs)
  }, [runs])

  return {
    quickActions: quickActionsWithStatus,
    onQuickAction: handleRunPreset,
    runs,
    activeRuns,
    debugMode,
    selectedRunId,
    onSelectRun: handleSelectRun,
    selectedRun,
    selectedTimeline,
    onViewerOpen: handleViewerOpen,
    shouldShowLatestRunPanel,
    successMessage,
    lastError,
    readMetaInfo,
    promptDiagnostics,
    lastOutput,
    onInspectRuns: handleInspectRuns
  }
}
