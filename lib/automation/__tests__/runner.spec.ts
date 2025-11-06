import { describe, it, expect, afterEach, vi } from "vitest"

import { runTask } from "../runner"
import { registerAction, requireAction } from "../actions"
import type { RegisteredAction, TaskDefinition } from "../types"

const originalStructured = requireAction("structured-prompt") as RegisteredAction<"structured-prompt">

describe("runTask", () => {
  afterEach(() => {
    registerAction("structured-prompt", originalStructured)
  })

  it("invokes callbacks and caches intermediate outputs", async () => {
    registerAction("structured-prompt", {
      ...originalStructured,
      async run(args) {
        if (args.step.id === "first") {
          expect(args.input).toBe("seed")
          return {
            success: true,
            output: { message: "first-output" },
            meta: { stepId: args.step.id }
          }
        }

        expect(args.cache.get("first")).toEqual({ message: "first-output" })
        expect(args.input).toEqual({ message: "first-output" })

        return {
          success: true,
          output: "complete",
          meta: { reusedCache: true }
        }
      }
    })

    const task: TaskDefinition = {
      id: "test",
      name: "Cache propagation",
      steps: [
        { id: "first", type: "structured-prompt" },
        { type: "structured-prompt" }
      ]
    }

    const onStepStart = vi.fn()
    const onStepComplete = vi.fn()
    const onError = vi.fn()

    const result = await runTask(task, {
      initialInput: "seed",
      onStepStart,
      onStepComplete,
      onError
    })

    expect(result.success).toBe(true)
    expect(result.output).toBe("complete")
    expect(result.steps).toHaveLength(2)

    expect(onStepStart).toHaveBeenCalledTimes(2)
    expect(onStepStart.mock.calls[0][0].id).toBe("first")
    expect(onStepComplete).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
  })

  it("aborts immediately when the provided signal is already cancelled", async () => {
    const controller = new AbortController()
    controller.abort()

    const task: TaskDefinition = {
      id: "abort",
      name: "Aborted task",
      steps: [{ type: "structured-prompt" }]
    }

    const onError = vi.fn()
    const result = await runTask(task, {
      signal: controller.signal,
      onError
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(Error)
    expect(result.steps).toHaveLength(0)
    expect(onError).toHaveBeenCalledTimes(1)
    const [step, error, index] = onError.mock.calls[0]
    expect(step.type).toBe("structured-prompt")
    expect(error).toBeInstanceOf(Error)
    expect(index).toBe(0)
    expect(error.message).toBe("Task run aborted")
  })

  it("propagates action exceptions and halts execution", async () => {
    registerAction("structured-prompt", {
      ...originalStructured,
      run() {
        throw new Error("forced failure")
      }
    })

    const task: TaskDefinition = {
      id: "error",
      name: "Error task",
      steps: [{ type: "structured-prompt" }]
    }

    const onError = vi.fn()
    const result = await runTask(task, { onError })

    expect(result.success).toBe(false)
    expect(result.steps).toHaveLength(0)
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe("forced failure")
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it("stops when an action reports failure and records intermediate steps", async () => {
    registerAction("structured-prompt", {
      ...originalStructured,
      async run(args) {
        if (args.step.id === "first") {
          return { success: true, output: "first" }
        }
        return { success: false, error: new Error("halted") }
      }
    })

    const task: TaskDefinition = {
      id: "failure",
      name: "Failure task",
      steps: [
        { id: "first", type: "structured-prompt" },
        { id: "second", type: "structured-prompt" }
      ]
    }

    const onStepComplete = vi.fn()
    const onError = vi.fn()

    const result = await runTask(task, {
      onStepComplete,
      onError
    })

    expect(result.success).toBe(false)
    expect(result.steps).toHaveLength(2)
    expect(result.steps[0].result.success).toBe(true)
    expect(result.steps[1].result.success).toBe(false)
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe("halted")

    expect(onStepComplete).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)
    const [failedStep] = onError.mock.calls[0]
    expect(failedStep.id).toBe("second")
  })
})
