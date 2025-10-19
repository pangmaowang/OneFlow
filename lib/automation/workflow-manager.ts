import { runTask } from "./runner"
import type {
  TaskDefinition,
  TaskRunOptions,
  TaskRunResult
} from "./types"

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"

export type WorkflowRunRecord = {
  id: string
  taskId: string
  taskName: string
  status: WorkflowRunStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  result?: TaskRunResult
  error?: Error
}

type QueuedRun = {
  id: string
  task: TaskDefinition
  options: TaskRunOptions
  controller: AbortController
}

type WorkflowListener = (runs: WorkflowRunRecord[]) => void

type WorkflowManagerOptions = {
  concurrency?: number
  idGenerator?: () => string
}

const defaultIdGenerator = () =>
  globalThis.crypto?.randomUUID?.() ?? `run_${Date.now()}_${Math.random().toString(16).slice(2)}`

export class WorkflowManager {
  private readonly options: Required<WorkflowManagerOptions>
  private readonly queue: QueuedRun[] = []
  private readonly runs: WorkflowRunRecord[] = []
  private readonly listeners = new Set<WorkflowListener>()
  private readonly activeControllers = new Map<string, AbortController>()
  private activeCount = 0

  constructor(options: WorkflowManagerOptions = {}) {
    this.options = {
      concurrency: options.concurrency ?? 1,
      idGenerator: options.idGenerator ?? defaultIdGenerator
    }
  }

  enqueue(task: TaskDefinition, options: TaskRunOptions = {}) {
    const runId = this.options.idGenerator()
    const controller = new AbortController()
    const record: WorkflowRunRecord = {
      id: runId,
      taskId: task.id,
      taskName: task.name,
      status: "queued",
      createdAt: Date.now()
    }

    this.runs.unshift(record)
    this.queue.push({ id: runId, task, options, controller })

    this.notify()
    this.processQueue()

    return runId
  }

  cancel(runId: string) {
    const queuedIndex = this.queue.findIndex((run) => run.id === runId)
    if (queuedIndex >= 0) {
      const [queued] = this.queue.splice(queuedIndex, 1)
      queued.controller.abort()
      this.updateRun(runId, {
        status: "cancelled",
        finishedAt: Date.now()
      })
      this.notify()
      return true
    }

    const controller = this.activeControllers.get(runId)
    if (controller) {
      controller.abort()
      return true
    }

    return false
  }

  getRuns() {
    return [...this.runs]
  }

  subscribe(listener: WorkflowListener) {
    this.listeners.add(listener)
    listener(this.getRuns())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private processQueue() {
    while (this.activeCount < this.options.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()
      if (!next) {
        break
      }
      this.startRun(next)
    }
  }

  private startRun(run: QueuedRun) {
    const { id: runId, task, options, controller } = run

    this.activeCount += 1
    this.activeControllers.set(runId, controller)
    this.updateRun(runId, {
      status: "running",
      startedAt: Date.now()
    })
    this.notify()

    void this.executeRun(runId, task, options, controller)
  }

  private async executeRun(
    runId: string,
    task: TaskDefinition,
    options: TaskRunOptions,
    controller: AbortController
  ) {
    try {
      const result = await runTask(task, {
        ...options,
        signal: controller.signal,
        onStepStart: (step, index) => {
          options.onStepStart?.(step, index)
        },
        onStepComplete: (step, stepResult, index) => {
          options.onStepComplete?.(step, stepResult, index)
        },
        onError: (step, error, index) => {
          options.onError?.(step, error, index)
        }
      })

      if (controller.signal.aborted) {
        this.updateRun(runId, {
          status: "cancelled",
          finishedAt: Date.now(),
          result,
          error: result.error
        })
      } else if (result.success) {
        this.updateRun(runId, {
          status: "succeeded",
          finishedAt: Date.now(),
          result
        })
      } else {
        this.updateRun(runId, {
          status: "failed",
          finishedAt: Date.now(),
          result,
          error: result.error
        })
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      this.updateRun(runId, {
        status: controller.signal.aborted ? "cancelled" : "failed",
        finishedAt: Date.now(),
        error: normalized
      })
    } finally {
      this.activeControllers.delete(runId)
      this.activeCount = Math.max(0, this.activeCount - 1)
      this.notify()
      this.processQueue()
    }
  }

  private updateRun(runId: string, patch: Partial<WorkflowRunRecord>) {
    const index = this.runs.findIndex((entry) => entry.id === runId)
    if (index >= 0) {
      this.runs[index] = {
        ...this.runs[index],
        ...patch
      }
    }
  }

  private notify() {
    const snapshot = this.getRuns()
    this.listeners.forEach((listener) => listener(snapshot))
  }
}
