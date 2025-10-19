import { describe, it, expect, afterEach } from "vitest"

import { registerAction, requireAction } from "../actions"
import { runTask } from "../runner"
import { WorkflowManager } from "../workflow-manager"
import { dailyDeveloperRecap } from "../presets"
import type { RegisteredAction, TaskDefinition } from "../types"

async function waitFor(condition: () => boolean, timeout = 500, interval = 10) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  throw new Error("Condition not met within timeout")
}

describe("automation pipeline", () => {
  it("runs the daily recap task end-to-end", async () => {
    const result = await runTask(dailyDeveloperRecap, {
      context: {
        pageContent:
          "Wrapped the OAuth migration today. Blockers resolved. Tomorrow we finish rollout.",
      },
    })

    expect(result.success).toBe(true)
    expect(typeof result.output).toBe("string")
    expect(result.output).toContain("Daily standup recap")

    const readStep = result.steps.find((entry) => entry.step.type === "read-page")
    const meta = (readStep?.result.meta as { truncated?: unknown } | undefined) ?? {}
    expect(meta.truncated).toBe(false)
  })

  it("falls back to default content and truncates when configured", async () => {
    const longFallback = "a".repeat(50)
    const action = requireAction("read-page")

    const result = await action.run({
      step: {
        type: "read-page",
        config: {
          fallback: longFallback,
          maxLength: 10,
        },
      },
      input: undefined,
      context: {},
      cache: new Map(),
    })

    expect(result.success).toBe(true)
    expect(result.output).toBe(`${longFallback.slice(0, 10)}…`)
    const meta = (result.meta as { truncated?: unknown } | undefined) ?? {}
    expect(meta.truncated).toBe(true)
  })
})

describe("workflow manager", () => {
  const originalStructured = requireAction("structured-prompt") as RegisteredAction<"structured-prompt">
  afterEach(() => {
    registerAction("structured-prompt", originalStructured)
  })

  const asyncTask: TaskDefinition = {
    id: "async-structured",
    name: "Structured prompt (async)",
    steps: [
      {
        type: "structured-prompt",
        config: {
          template: "Hello {{input}}",
          outputFormat: "text",
        },
      },
    ],
  }

  it("queues and runs tasks sequentially", async () => {
    let callCount = 0

    registerAction("structured-prompt", {
      ...originalStructured,
      async run(args) {
        callCount += 1
        await new Promise((resolve) => setTimeout(resolve, callCount === 1 ? 40 : 10))
        return originalStructured.run(args)
      },
    })

    let idCounter = 0
    const manager = new WorkflowManager({
      concurrency: 1,
      idGenerator: () => `run-${idCounter++}`,
    })

    const firstId = manager.enqueue(asyncTask, {
      initialInput: "first",
    })
    const secondId = manager.enqueue(asyncTask, {
      initialInput: "second",
    })

    await waitFor(() => {
      const runs = manager.getRuns()
      const first = runs.find((run) => run.id === firstId)
      const second = runs.find((run) => run.id === secondId)
      return first?.status === "running" && second?.status === "queued"
    })

    await waitFor(() => manager.getRuns().some((run) => run.id === firstId && run.status === "succeeded"))
    await waitFor(() => manager.getRuns().some((run) => run.id === secondId && run.status === "succeeded"))

    const runs = manager.getRuns()
    const firstResult = runs.find((run) => run.id === firstId)
    const secondResult = runs.find((run) => run.id === secondId)

    expect(firstResult?.result?.success).toBe(true)
    expect(secondResult?.result?.success).toBe(true)
    expect(callCount).toBe(2)
  })

  it("cancels queued runs", async () => {
    registerAction("structured-prompt", {
      ...originalStructured,
      async run(args) {
        await new Promise((resolve) => setTimeout(resolve, 40))
        return originalStructured.run(args)
      },
    })

    let idCounter = 0
    const manager = new WorkflowManager({
      concurrency: 1,
      idGenerator: () => `run-${idCounter++}`,
    })

    const firstId = manager.enqueue(asyncTask, { initialInput: "first" })
    const secondId = manager.enqueue(asyncTask, { initialInput: "second" })

    const cancelled = manager.cancel(secondId)
    expect(cancelled).toBe(true)

    await waitFor(() => manager.getRuns().some((run) => run.id === secondId && run.status === "cancelled"))
    await waitFor(() => manager.getRuns().some((run) => run.id === firstId && run.status === "succeeded"))

    const runs = manager.getRuns()
    const cancelledRun = runs.find((run) => run.id === secondId)

    expect(cancelledRun?.status).toBe("cancelled")
    expect(cancelledRun?.result).toBeUndefined()
  })
})
