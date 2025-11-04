import { afterEach, describe, expect, test } from "vitest"

import type { TaskDefinition } from "@/lib/automation"

import { MAX_DEBUG_ENTRIES, PREVIEW_LIMIT } from "../config"
import {
  formatOutputPreview,
  initializeStepSnapshots,
  resolveDebugEnvFlag,
  summarizeStepMeta
} from "../utils/popup-utils"

const ORIGINAL_DEBUG_ENV = process.env.PLASMO_PUBLIC_AUTOMATION_DEBUG

afterEach(() => {
  if (ORIGINAL_DEBUG_ENV === undefined) {
    delete process.env.PLASMO_PUBLIC_AUTOMATION_DEBUG
  } else {
    process.env.PLASMO_PUBLIC_AUTOMATION_DEBUG = ORIGINAL_DEBUG_ENV
  }
})

describe("resolveDebugEnvFlag", () => {
  test("returns false when no debug flags are present", () => {
    delete process.env.PLASMO_PUBLIC_AUTOMATION_DEBUG
    expect(resolveDebugEnvFlag()).toBe(false)
  })

  test("returns true when process env flag is set", () => {
    process.env.PLASMO_PUBLIC_AUTOMATION_DEBUG = "true"
    expect(resolveDebugEnvFlag()).toBe(true)
  })

  test("treats non-true values as disabled", () => {
    process.env.PLASMO_PUBLIC_AUTOMATION_DEBUG = "false"
    expect(resolveDebugEnvFlag()).toBe(false)
  })
})

describe("initializeStepSnapshots", () => {
  test("creates pending snapshots for each step", () => {
    const task: TaskDefinition = {
      id: "test",
      name: "Test task",
      steps: [
        { id: "read", type: "read-page", description: "Read" },
        { type: "structured-prompt", description: "Prompt" }
      ]
    }

    const snapshots = initializeStepSnapshots(task)

    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]).toMatchObject({
      key: "read",
      index: 0,
      stepId: "read",
      type: "read-page",
      status: "pending"
    })
    expect(snapshots[1]).toMatchObject({
      key: "structured-prompt-1",
      index: 1,
      stepId: undefined,
      type: "structured-prompt",
      status: "pending"
    })
  })
})

describe("formatOutputPreview", () => {
  test("returns null for nullish values", () => {
    expect(formatOutputPreview(null)).toBeNull()
    expect(formatOutputPreview(undefined)).toBeNull()
  })

  test("trims string output", () => {
    expect(formatOutputPreview("  hello world  ")).toBe("hello world")
  })

  test("returns null for empty strings after trimming", () => {
    expect(formatOutputPreview("   ")).toBeNull()
  })

  test("truncates long strings and appends ellipsis", () => {
    const longString = "x".repeat(PREVIEW_LIMIT + 10)
    const preview = formatOutputPreview(longString)

    expect(preview).not.toBeNull()
    expect(preview).toHaveLength(PREVIEW_LIMIT + 1)
    expect(preview?.endsWith("…")).toBe(true)
  })

  test("stringifies non-string values", () => {
    const preview = formatOutputPreview({ foo: "bar" })
    expect(preview).toContain("\"foo\": \"bar\"")
  })
})

describe("summarizeStepMeta", () => {
  const baseMeta = {
    viewerKey: "viewer-123",
    fallbackUsed: true,
    fallbackReason: "Prompt API unavailable",
    usedPromptApi: false,
    rawPreview: "raw",
    normalizedPreview: "normalized",
    artifactId: "artifact-42",
    artifactType: "note",
    viewerAvailable: true,
    rawLength: 128,
    parsed: true,
    parsedSource: "model",
    normalizedFields: ["summary", "tags"],
    debug: Array.from({ length: MAX_DEBUG_ENTRIES + 3 }, (_, index) => `debug-${index}`),
    promptLength: 2048,
    resultLength: 1024,
    expectsJson: true
  }

  test("omits debug details when debug mode is disabled", () => {
    const summary = summarizeStepMeta(baseMeta, false)

    expect(summary).toMatchObject({
      viewerKey: "viewer-123",
      fallbackUsed: true,
      fallbackReason: "Prompt API unavailable",
      usedPromptApi: false,
      rawPreview: "raw",
      normalizedPreview: "normalized",
      artifactId: "artifact-42",
      artifactType: "note",
      viewerAvailable: true,
      rawLength: 128,
      parsed: true,
      parsedSource: "model",
      normalizedFields: ["summary", "tags"]
    })
    expect(summary).not.toHaveProperty("debug")
    expect(summary).not.toHaveProperty("promptLength")
    expect(summary).not.toHaveProperty("resultLength")
  })

  test("includes debug details when debug mode is enabled", () => {
    const summary = summarizeStepMeta(baseMeta, true)

    expect(summary?.debug).toEqual(baseMeta.debug.slice(-MAX_DEBUG_ENTRIES))
    expect(summary).toMatchObject({
      promptLength: 2048,
      resultLength: 1024,
      expectsJson: true
    })
  })

  test("returns null when meta payload is empty", () => {
    expect(summarizeStepMeta(null, false)).toBeNull()
    expect(summarizeStepMeta(undefined, true)).toBeNull()
  })
})
