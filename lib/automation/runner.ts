import { requireAction } from "./actions"
import type {
  ActionExecutionResult,
  TaskDefinition,
  TaskRunOptions,
  TaskRunResult
} from "./types"

export async function runTask(
  task: TaskDefinition,
  options: TaskRunOptions = {}
): Promise<TaskRunResult> {
  const {
    initialInput,
    context = {},
    signal,
    onStepStart,
    onStepComplete,
    onError
  } = options

  const cache = new Map<string, unknown>()
  const steps: TaskRunResult["steps"] = []
  let currentInput = initialInput

  for (let index = 0; index < task.steps.length; index += 1) {
    const step = task.steps[index]

    if (signal?.aborted) {
      const abortError = new Error("Task run aborted")
      onError?.(step, abortError, index)
      return {
        success: false,
        error: abortError,
        steps
      }
    }

    onStepStart?.(step, index)

    const action = requireAction(step.type)
    let result: ActionExecutionResult

    try {
      result = await action.run({
        step,
        input: currentInput,
        context,
        cache,
        signal
      })
    } catch (error) {
      const handledError = error instanceof Error ? error : new Error(String(error))
      onError?.(step, handledError, index)
      return {
        success: false,
        error: handledError,
        steps
      }
    }

    steps.push({ step, result })
    onStepComplete?.(step, result, index)

    if (!result.success) {
      const failureError = result.error ?? new Error(`Action \"${step.type}\" failed`)
      onError?.(step, failureError, index)
      return {
        success: false,
        error: failureError,
        steps
      }
    }

    if (step.id && result.output !== undefined) {
      cache.set(step.id, result.output)
    }

    currentInput = result.output
  }

  return {
    success: true,
    output: currentInput,
    steps
  }
}

export function createTaskRunner(defaultOptions: TaskRunOptions = {}) {
  return (task: TaskDefinition, overrides?: TaskRunOptions) =>
    runTask(task, { ...defaultOptions, ...overrides })
}

export type { TaskDefinition, TaskRunOptions, TaskRunResult } from "./types"
export type { AutomationStep } from "./types"
