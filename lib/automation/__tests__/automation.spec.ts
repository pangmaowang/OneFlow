import { describe, it, expect, afterEach } from "vitest"

import { registerAction, requireAction } from "../actions"
import { runTask } from "../runner"
import { WorkflowManager } from "../workflow-manager"
import { dailyDeveloperRecap, blogResearchCapture } from "../presets"
import type { RegisteredAction, TaskDefinition } from "../types"
import { clearArtifacts, listArtifacts } from "../../storage"

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
  afterEach(async () => {
    await clearArtifacts()
  })

  it("runs the daily recap task end-to-end", async () => {
    const originalAi = (globalThis as Record<string, unknown>).ai
    const recapPayload = {
      summary: "Shipped OAuth migration fixes and aligned on tomorrow's rollout.",
      highlights: ["Resolved long-standing OAuth migration blockers"],
      blockers: [],
      nextFocus: ["Monitor production rollout"],
      actionItems: ["Draft post-release QA checklist"],
      draftPullRequest: {
        title: "OAuth migration polish",
        content: "## Summary\n- Hardened refresh token flow\n- Added smoke tests",
        potentialRegressions: ["OAuth login flows"],
        blastRadius: "Auth service, session refresh"
      }
    }

    ;(globalThis as Record<string, unknown>).ai = {
      languageModel: {
        async availability() {
          return "available"
        },
        async create() {
          return {
            async prompt(payload: unknown) {
              expect(payload).toBeDefined()
              return JSON.stringify(recapPayload)
            },
            destroy() {
              /* noop */
            }
          }
        }
      }
    }

    try {
      const result = await runTask(dailyDeveloperRecap, {
        context: {
          pageContent:
            "Wrapped the OAuth migration today. Blockers resolved. Tomorrow we finish rollout."
        }
      })

      expect(result.success).toBe(true)
      expect(result.output).toBeTruthy()

      const artifact = result.output as {
        type: string
        payload: { parsed?: unknown }
      }

      expect(artifact.type).toBe("daily-dev-recap")
  const parsedArtifact = artifact.payload.parsed as typeof recapPayload
  expect(parsedArtifact).toMatchObject(recapPayload)
  expect(parsedArtifact.draftPullRequest).toMatchObject(recapPayload.draftPullRequest)

      const readStep = result.steps.find((entry) => entry.step.type === "read-page")
      const readMeta =
        (readStep?.result.meta as { truncated?: unknown; fromContext?: unknown } | undefined) ?? {}
      expect(readMeta.truncated).toBe(false)
      expect(readMeta.fromContext).toBe(true)

      const promptStep = result.steps.find((entry) => entry.step.type === "structured-prompt")
      const promptMeta = (promptStep?.result.meta ?? {}) as Record<string, unknown>
      expect(promptMeta.usedPromptApi).toBe(true)

      const [stored] = await listArtifacts({ type: "daily-dev-recap", limit: 1 })
      expect(stored).toBeDefined()
  const storedParsed = stored?.payload.parsed as typeof recapPayload | undefined
  expect(storedParsed).toBeDefined()
  expect(storedParsed!).toMatchObject(recapPayload)
    } finally {
      if (originalAi === undefined) {
        delete (globalThis as Record<string, unknown>).ai
      } else {
        (globalThis as Record<string, unknown>).ai = originalAi
      }
    }
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
          source: "html",
        },
      },
      input: undefined,
      context: {},
      cache: new Map(),
    })

    expect(result.success).toBe(true)
    expect(result.output).toBe(`${longFallback.slice(0, 10)}…`)
    const meta =
      (result.meta as { truncated?: unknown; fallbackUsed?: unknown } | undefined) ?? {}
    expect(meta.truncated).toBe(true)
    expect(meta.fallbackUsed).toBe(true)
  })

  it("sanitizes html payloads when provided directly", async () => {
    const html = `
      <article>
        <h1>Breaking News</h1>
        <script>window.evil()</script>
        <p>The build is green and shipping today.</p>
      </article>
    `

    const action = requireAction("read-page")
    const result = await action.run({
      step: {
        type: "read-page",
        config: {
          source: "html",
        },
      },
      input: undefined,
      context: {
        pageContent: html,
      },
      cache: new Map(),
    })

    expect(result.success).toBe(true)
    expect(result.output).toContain("Breaking News")
    expect(result.output).toContain("The build is green and shipping today.")
    expect(result.output).not.toContain("evil")
  })

  it("runs the blog research workflow end-to-end", async () => {
    const originalAi = (globalThis as Record<string, unknown>).ai
    const messyBlogPayload = {
      summary: ["  Generative UI thrives when resilient tracing keeps interfaces honest.  "],
      tags: ["  generative-ui  ", { slug: "observability" }, ["generative-ui"], "frontend-ai"],
      keyInsights: [
        "1. Treat traces as user-facing telemetry",
        { text: "Map interaction debt before scaling" },
        ["Treat traces as user-facing telemetry"]
      ],
      technicalHighlights: [
        "OpenTelemetry spans",
        { text: "LLM guardrails" },
        ["Circuit breakers for UI"]
      ],
      narrativeDirections: [
        "• Contrast pre/post tracing workflows",
        { value: "Guide: building dashboards that reveal prompt drift" }
      ],
      supportingLinks: [
        "https://example.com/tracing",
        { url: "https://example.com/prompt-drift" },
        "https://example.com/tracing"
      ],
      sourceUrl: [" https://example.com/original ", { url: "https://example.com/original" }]
    }

    const normalizedBlogPayload = {
      summary: "Generative UI thrives when resilient tracing keeps interfaces honest.",
      tags: ["generative-ui", "observability", "frontend-ai"],
      keyInsights: [
        "Treat traces as user-facing telemetry",
        "Map interaction debt before scaling"
      ],
      technicalHighlights: [
        "OpenTelemetry spans",
        "LLM guardrails",
        "Circuit breakers for UI"
      ],
      narrativeDirections: [
        "Contrast pre/post tracing workflows",
        "Guide: building dashboards that reveal prompt drift"
      ],
      supportingLinks: [
        "https://example.com/tracing",
        "https://example.com/prompt-drift"
      ],
      sourceUrl: "https://example.com/original"
    }

    ;(globalThis as Record<string, unknown>).ai = {
      languageModel: {
        async availability() {
          return "available"
        },
        async create() {
          return {
            async prompt() {
              return JSON.stringify(messyBlogPayload)
            },
            destroy() {
              /* noop */
            }
          }
        }
      }
    }

    try {
      const result = await runTask(blogResearchCapture, {
        context: {
          pageContent:
            "Design systems need resilience. Outline async loading states, fallback patterns, and token layering strategies."
        }
      })

      expect(result.success).toBe(true)

      const artifact = result.output as {
        type: string
        payload: { parsed?: unknown }
      }

  expect(artifact.type).toBe("blog-research-note")
  const parsed = artifact.payload.parsed as typeof normalizedBlogPayload
  expect(parsed).toMatchObject(normalizedBlogPayload)
  expect(parsed.sourceUrl).toBe("https://example.com/original")

      const promptStep = result.steps.find((entry) => entry.step.type === "blog-prompt")
      const promptMeta = (promptStep?.result.meta ?? {}) as Record<string, unknown>
  expect(promptMeta.blogPrompt).toBe(true)
  expect(promptMeta.blogSchemaVersion).toBe("blog-v3")

      const [stored] = await listArtifacts({ type: "blog-research-note", limit: 1 })
      expect(stored).toBeDefined()
  const storedParsed = stored?.payload.parsed as typeof normalizedBlogPayload | undefined
      expect(storedParsed).toBeDefined()
  expect(storedParsed!).toMatchObject(normalizedBlogPayload)
    } finally {
      if (originalAi === undefined) {
        delete (globalThis as Record<string, unknown>).ai
      } else {
        (globalThis as Record<string, unknown>).ai = originalAi
      }
    }
  })
})

describe("structured-prompt normalization", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).ai
  })

  it("normalizes structured fields based on schema and heuristics", async () => {
    const action = requireAction("structured-prompt")

    const messyResponse = JSON.stringify({
      summary: ["Wrapped auth", "Need sign-off"],
      highlights: [
        "• Shipped async retries",
        { text: "Coordinated rollout" },
        "Shipped async retries"
      ],
      blockers: "1. QA pending\n- Approvals missing",
      nextFocus: [["Ship release"], { title: "Prep docs" }, "Ship release"],
      actionItems: [
        { label: "Review PR" },
        "• Review PR",
        { description: "Sync with QA" }
      ],
      draftPullRequest: {
        title: ["  Auth rollout   "],
        content: ["Cleaned up auth flows", { text: "Need release notes" }],
        potentialRegressions: [
          "• Login",
          { text: "Session expiry" },
          "Login"
        ],
        blastRadius: { text: "Auth service + session cache" },
        extraField: "should disappear"
      }
    })

    ;(globalThis as Record<string, unknown>).ai = {
      languageModel: {
        async availability() {
          return "available"
        },
        async create() {
          return {
            async prompt() {
              return messyResponse
            },
            destroy() {
              /* noop */
            }
          }
        }
      }
    }

    const result = await action.run({
      step: {
        type: "structured-prompt",
        config: {
          template: "{{input}}",
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              highlights: { type: "array", items: { type: "string" } },
              blockers: { type: "array", items: { type: "string" } },
              nextFocus: { type: "array", items: { type: "string" } },
              actionItems: { type: "array", items: { type: "string" } }
            },
            required: ["summary"],
            additionalProperties: true
          },
          usePromptApi: true,
          coerceJsonOutput: true
        }
      },
      input: {
        notes: "Wrapped auth migration"
      },
      context: {},
      cache: new Map()
    })

    expect(result.success).toBe(true)

    const output = result.output as Record<string, unknown>
    expect(typeof output.summary).toBe("string")
    expect(output.summary).toBe("Wrapped auth\nNeed sign-off")

    expect(Array.isArray(output.highlights)).toBe(true)
    expect(output.highlights).toEqual(["Shipped async retries", "Coordinated rollout"])

    expect(Array.isArray(output.blockers)).toBe(true)
    expect(output.blockers).toEqual(["QA pending", "Approvals missing"])

    expect(Array.isArray(output.nextFocus)).toBe(true)
    expect(output.nextFocus).toEqual(["Ship release", "Prep docs"])

    expect(Array.isArray(output.actionItems)).toBe(true)
    expect(output.actionItems).toEqual(["Review PR", "Sync with QA"])

    const draft = output.draftPullRequest as {
      title: string
      content: string
      potentialRegressions: string[]
      blastRadius: string
    }

    expect(draft).toEqual({
      title: "Auth rollout",
      content: "Cleaned up auth flows\nNeed release notes",
      potentialRegressions: ["Login", "Session expiry"],
      blastRadius: "Auth service + session cache"
    })

    const meta = result.meta as Record<string, unknown>
    expect(Array.isArray(meta?.normalizedFields)).toBe(true)
    expect(new Set(meta?.normalizedFields as string[])).toEqual(
      new Set([
        "highlights",
        "blockers",
        "nextFocus",
        "actionItems",
        "summary",
        "draftPullRequest.title",
        "draftPullRequest.content",
        "draftPullRequest.potentialRegressions",
        "draftPullRequest.blastRadius",
        "draftPullRequest.extraField"
      ])
    )
    expect(meta?.parsedSource).toBe("normalized")
  })
})

describe("store-artifact action", () => {
  afterEach(async () => {
    await clearArtifacts()
  })

  it("persists structured payloads with metadata", async () => {
    const action = requireAction("store-artifact")

    const payload = JSON.stringify({ summary: "Completed auth migration" })
    const result = await action.run({
      step: {
        id: "persist",
        type: "store-artifact",
        config: {
          artifactType: "prompt-result",
          metadata: {
            label: "weekly-recap"
          },
          tags: ["weekly", "prompt"],
          parseJson: true
        }
      },
      input: payload,
      context: {},
      cache: new Map()
    })

    expect(result.success).toBe(true)
    expect(result.meta?.artifactId).toBeTruthy()

    const [stored] = await listArtifacts()
    expect(stored).toBeDefined()
    expect(stored.type).toBe("prompt-result")
    expect(stored.metadata?.label).toBe("weekly-recap")
    expect(stored.tags).toEqual(["weekly", "prompt"])
    expect(stored.payload.raw).toBe(payload)
    expect(stored.payload.parsed).toMatchObject({ summary: "Completed auth migration" })
  })

  it("skips persistence when configured and input is empty", async () => {
    const action = requireAction("store-artifact")

    const result = await action.run({
      step: {
        type: "store-artifact",
        config: {
          skipWhenEmpty: true
        }
      },
      input: "   ",
      context: {},
      cache: new Map()
    })

    expect(result.success).toBe(true)
    expect(result.meta?.skipped).toBe(true)

    const stored = await listArtifacts()
    expect(stored.length).toBe(0)
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
