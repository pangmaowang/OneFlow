/**
 * @vitest-environment jsdom
 */
import React, { useEffect } from "react"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/chrome-storage", () => ({
  storageGet: vi.fn(),
  storageRemove: vi.fn()
}))

import { storageGet, storageRemove } from "@/lib/chrome-storage"
import {
  buildSections,
  buildMarkdownExport,
  resolveStructuredPayload,
  useCopy,
  useViewerData
} from "../logic"
import type { CopyState, ViewerPayload } from "../types"

function ViewerDataHarness({
  onUpdate
}: {
  onUpdate: (value: ReturnType<typeof useViewerData>) => void
}) {
  const result = useViewerData()

  useEffect(() => {
    onUpdate(result)
  }, [onUpdate, result])

  return null
}

function CopyHarness({ onUpdate }: { onUpdate: (value: ReturnType<typeof useCopy>) => void }) {
  const value = useCopy()

  useEffect(() => {
    onUpdate(value)
  }, [onUpdate, value])

  return null
}

describe("prompt viewer logic", () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    window.history.replaceState({}, "", "/")
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    // reset clipboard stub to avoid leaking across tests
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "clipboard")
  })

  describe("useViewerData", () => {
    it("initialises in loading state and hydrates payload when storage resolves", async () => {
      const payload: ViewerPayload = {
        id: "run-123",
        raw: "{\"summary\":\"Hello\"}",
        parsed: { summary: "Hello" },
        createdAt: Date.now(),
        meta: {
          taskId: "task-1",
          taskName: "Daily recap",
          stepId: "step-1"
        }
      }

      const key = "viewer-key"
      window.history.replaceState({}, "", `/?key=${key}`)
      ;(globalThis as unknown as Record<string, unknown>).chrome = { runtime: { id: "ext-123" } }
      const storageGetMock = storageGet as unknown as ReturnType<typeof vi.fn>
      storageGetMock.mockResolvedValueOnce(payload)

      const updates: Array<ReturnType<typeof useViewerData>> = []
      const handleUpdate = (value: ReturnType<typeof useViewerData>) => {
        updates.push(value)
      }

      render(<ViewerDataHarness onUpdate={handleUpdate} />)

      await waitFor(() => {
        expect(updates.length).toBeGreaterThan(0)
        expect(updates[updates.length - 1].state).toBe("ready")
      })

      const latest = updates[updates.length - 1]
      expect(latest.payload).toEqual(payload)
      expect(latest.errorMessage).toBeNull()
      expect(storageGet).toHaveBeenCalledWith(key)
      expect(storageRemove).toHaveBeenCalledWith(key)
    })

    it("surfaces an error when the extension runtime is unavailable", async () => {
      Reflect.deleteProperty(globalThis, "chrome")
      window.history.replaceState({}, "", "/?key=failure")

      const updates: Array<ReturnType<typeof useViewerData>> = []
      const handleUpdate = (value: ReturnType<typeof useViewerData>) => {
        updates.push(value)
      }

      render(<ViewerDataHarness onUpdate={handleUpdate} />)

      await waitFor(() => {
        expect(updates.length).toBeGreaterThan(0)
        expect(updates[updates.length - 1].state).toBe("error")
      })

      const latest = updates[updates.length - 1]
      expect(latest.errorMessage).toContain("Chrome extension runtime")
      expect(storageGet).not.toHaveBeenCalled()
      expect(storageRemove).not.toHaveBeenCalled()
    })
  })

  describe("useCopy", () => {
    it("writes to the clipboard and resets status after the cooldown", async () => {
      vi.useFakeTimers()
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
        writable: true
      })

      let latest: ReturnType<typeof useCopy> | null = null
      let latestState: CopyState | null = null
      const handleUpdate = (value: ReturnType<typeof useCopy>) => {
        latest = value
        latestState = value.copyState
      }

      render(<CopyHarness onUpdate={handleUpdate} />)

      await act(async () => {
        await Promise.resolve()
      })
      expect(latest).not.toBeNull()

      await act(async () => {
        await latest!.copy("summary", "copy me")
      })

      expect(writeText).toHaveBeenCalledWith("copy me")
      expect(latestState?.status).toBe("copied")
      expect(latestState?.target).toBe("summary")

      await act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(latestState?.status).toBe("idle")
    })

    it("marks the state as error when the clipboard API rejects", async () => {
      vi.useFakeTimers()
      const writeText = vi.fn().mockRejectedValue(new Error("denied"))
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
        writable: true
      })

      let latest: ReturnType<typeof useCopy> | null = null
      let latestState: CopyState | null = null
      const handleUpdate = (value: ReturnType<typeof useCopy>) => {
        latest = value
        latestState = value.copyState
      }

      render(<CopyHarness onUpdate={handleUpdate} />)

      await act(async () => {
        await Promise.resolve()
      })
      expect(latest).not.toBeNull()

      await act(async () => {
        await latest!.copy("summary", "copy me")
      })

      expect(writeText).toHaveBeenCalledWith("copy me")
      expect(latestState?.status).toBe("error")

      await act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(latestState?.status).toBe("idle")
    })
  })

  describe("payload helpers", () => {
    it("prefers the parsed payload when available and falls back to JSON parsing", () => {
      const parsedPayload = { summary: "Ready" }
      const withParsed = resolveStructuredPayload({
        id: "1",
        raw: "{}",
        parsed: parsedPayload,
        createdAt: 1
      })
      expect(withParsed).toBe(parsedPayload)

      const fromJson = resolveStructuredPayload({
        id: "2",
        raw: '{"summary":"From raw"}',
        createdAt: 2
      } as ViewerPayload)
      expect(fromJson).toEqual({ summary: "From raw" })

      const rawString = resolveStructuredPayload({
        id: "3",
        raw: "plain text",
        createdAt: 3
      } as ViewerPayload)
      expect(rawString).toBe("plain text")
    })

    it("builds recognised sections and keeps unknown keys as extras", () => {
      const structured = {
        timeframe: { label: "Last 7 days" },
        totals: { notes: 10 },
        summary: "Weekly snapshot",
        highlights: ["Shipped new onboarding"],
        customField: { nested: "value" }
      }

      const sections = buildSections(structured)
      const sectionKeys = sections.map((section) => section.descriptor.key)
      expect(sectionKeys).toContain("digestSnapshot")
      expect(sectionKeys).toContain("summary")
      expect(sectionKeys).toContain("highlights")
      expect(sectionKeys).toContain("customField")

      const customSection = sections.find((section) => section.descriptor.key === "customField")
      expect(customSection?.descriptor.title).toBe("Custom Field")
    })

    it("produces markdown exports that reflect structured fields and raw output", () => {
      const payload: ViewerPayload = {
        id: "export-1",
        raw: "raw-output",
        createdAt: 4,
        meta: { taskName: "Digest" }
      }

      const structured = {
        summary: "Completed migration",
        actionItems: ["Schedule retro"]
      }

      const markdown = buildMarkdownExport(structured, payload)
      expect(markdown).toContain("# Digest")
      expect(markdown).toContain("Completed migration")
      expect(markdown).toContain("Schedule retro")
      expect(markdown).toContain("raw-output")
    })
  })
})
