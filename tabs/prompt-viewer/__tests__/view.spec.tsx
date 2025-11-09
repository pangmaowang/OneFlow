/**
 * @vitest-environment jsdom
 */
import React from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PromptViewerView } from "../view"
import type { SectionInstance, ViewerPayload } from "../types"

describe("PromptViewerView", () => {
  afterEach(() => {
    cleanup()
  })

  const payload: ViewerPayload = {
    id: "viewer",
    raw: "raw-output",
    createdAt: Date.now(),
    meta: { taskName: "Weekly Digest" }
  }

  it("renders the loading indicator", () => {
    render(
      <PromptViewerView
        state="loading"
        errorMessage={null}
        payload={null}
        sections={[]}
        copyState={{ status: "idle" }}
        onCopy={vi.fn()}
        onExportMarkdown={vi.fn()}
      />
    )

    expect(screen.getByText("Loading structured result…")).toBeTruthy()
  })

  it("renders the error state with the provided message", () => {
    const message = "Runtime missing"
    render(
      <PromptViewerView
        state="error"
        errorMessage={message}
        payload={null}
        sections={[]}
        copyState={{ status: "idle" }}
        onCopy={vi.fn()}
        onExportMarkdown={vi.fn()}
      />
    )

    expect(screen.getByText("Unable to load result")).toBeTruthy()
    expect(screen.getByText(message)).toBeTruthy()
  })

  it("renders structured sections, fires copy callback, and exports markdown", () => {
    const sections: SectionInstance[] = [
      {
        descriptor: {
          key: "summary",
          title: "Summary",
          render: () => <p data-testid="section-body">Structured summary</p>,
          copyValue: () => "copy me"
        },
        value: "Structured summary"
      }
    ]

    const onCopy = vi.fn()
    const onExport = vi.fn()

    render(
      <PromptViewerView
        state="ready"
        errorMessage={null}
        payload={payload}
        sections={sections}
        copyState={{ status: "idle" }}
        onCopy={onCopy}
        onExportMarkdown={onExport}
        formattedCreatedAt="Nov 8, 2025"
      />
    )

    expect(screen.getByText("Automation playback")).toBeTruthy()
    expect(screen.getByTestId("section-body")).toBeTruthy()
    expect(screen.getByText("Weekly Digest · Nov 8, 2025")).toBeTruthy()

    const downloadButton = screen.getByRole("button", { name: "Download report" })
    fireEvent.click(downloadButton)
    expect(onExport).toHaveBeenCalledTimes(1)

    const copyButton = screen.getByRole("button", { name: "Copy" })
    fireEvent.click(copyButton)
    expect(onCopy).toHaveBeenCalledWith("summary", "copy me")

    const sectionElement = copyButton.closest("section")
    expect(sectionElement?.className).toContain("lg:col-span-2")
  })

  it("renders the empty-state card when no sections are available", () => {
    render(
      <PromptViewerView
        state="ready"
        errorMessage={null}
        payload={{ ...payload, raw: "raw body" }}
        sections={[]}
        copyState={{ status: "idle" }}
        onCopy={vi.fn()}
        onExportMarkdown={vi.fn()}
      />
    )

    expect(screen.getByText("No structured result")).toBeTruthy()
    expect(screen.getByText("raw body")).toBeTruthy()
  })

  it("omits the export button when payload metadata is absent", () => {
    render(
      <PromptViewerView
        state="ready"
        errorMessage={null}
        payload={null}
        sections={[]}
        copyState={{ status: "idle" }}
        onCopy={vi.fn()}
        onExportMarkdown={vi.fn()}
      />
    )

    const buttons = screen.queryByRole("button", { name: "Download report" })
    expect(buttons).toBeNull()
  })
})
