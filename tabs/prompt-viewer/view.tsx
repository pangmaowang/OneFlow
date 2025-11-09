import React from "react"

import { FileDown } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

import { CopyButton } from "./components/copy-button"
import { CodeSurface } from "./components/code-surface"
import { WIDE_SECTION_KEYS } from "./sections"
import type { CopyState, LoadState, SectionInstance, ViewerPayload } from "./types"

export type PromptViewerViewProps = {
  state: LoadState
  errorMessage: string | null
  payload: ViewerPayload | null
  sections: SectionInstance[]
  copyState: CopyState
  onCopy: (sectionKey: string, copyValue: string) => void
  onExportMarkdown: () => void
  formattedCreatedAt?: string
}

export function PromptViewerView({
  state,
  errorMessage,
  payload,
  sections,
  copyState,
  onCopy,
  onExportMarkdown,
  formattedCreatedAt
}: PromptViewerViewProps) {
  if (state === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted text-muted-foreground">
        <p className="text-sm">Loading structured result…</p>
      </div>
    )
  }

  if (state === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted text-muted-foreground">
        <Card className="w-[480px] max-w-full border-destructive/40 bg-destructive/10 text-destructive">
          <CardHeader>
            <CardTitle className="text-base">Unable to load result</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{errorMessage ?? "Unknown error."}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="space-y-4">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Result snapshot
              </p>
              <h1 className="text-2xl font-semibold md:text-3xl">Automation playback</h1>
              <p className="max-w-3xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                Skim the structured recap without digging through raw notes—the viewer keeps the highlights, risks, and next moves front and center.
              </p>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {payload?.meta?.taskName ?? "Automation output"}
              {formattedCreatedAt ? ` · ${formattedCreatedAt}` : null}
            </p>
            {payload ? (
              <button
                type="button"
                onClick={onExportMarkdown}
                className="inline-flex items-start gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 focus:ring-offset-white hover:bg-gray-800 dark:bg-gray-50 dark:text-gray-900 dark:hover:bg-gray-200 dark:focus:ring-gray-100 dark:focus:ring-offset-gray-900"
              >
                <FileDown className="mt-0.5 h-4 w-4" aria-hidden="true" />
                <span className="pt-0.5 leading-tight">Download report</span>
              </button>
            ) : null}
          </div>
        </section>

        {sections.length === 0 ? (
          <section className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">No structured result</h2>
            <p className="mt-2 text-sm">
              The automation returned data that doesn&apos;t map to the usual sections.
            </p>
            <p className="mt-4 text-sm">
              Re-run the flow or tweak your prompt so it emits structured fields like summary, highlights, or action items.
            </p>
            {payload?.raw ? (
              <div className="mt-6 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Raw output
                </p>
                <CodeSurface value={payload.raw} className="mt-1" />
              </div>
            ) : null}
          </section>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {sections.map(({ descriptor, value }) => {
              const allowCopy = descriptor.copyValue?.(value)
              const Icon = descriptor.icon
              const layoutClass = WIDE_SECTION_KEYS.has(descriptor.key) ? "lg:col-span-2" : "lg:col-span-1"

              return (
                <section
                  key={descriptor.key}
                  className={cn(
                    "relative rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900",
                    layoutClass
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      {Icon ? (
                        <span className="flex h-10 w-10 items-start justify-center rounded-full bg-gray-100 pt-1 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                      ) : null}
                      <div className="space-y-1">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{descriptor.title}</h2>
                        {descriptor.description ? (
                          <p className="text-sm text-gray-500 dark:text-gray-400">{descriptor.description}</p>
                        ) : null}
                      </div>
                    </div>
                    {allowCopy ? (
                      <CopyButton
                        target={descriptor.key}
                        copyState={copyState}
                        onCopy={() => onCopy(descriptor.key, allowCopy)}
                        className="self-start"
                      >
                        Copy
                      </CopyButton>
                    ) : null}
                  </div>
                  <div className="mt-6 border-t border-gray-200 pt-6 dark:border-gray-800">{descriptor.render(value)}</div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
