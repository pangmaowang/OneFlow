import React from "react"

import { cn } from "@/lib/utils"

type CodeSurfaceProps = {
  value: string
  className?: string
  withBorder?: boolean
}

export function CodeSurface({ value, className, withBorder = true }: CodeSurfaceProps) {
  return (
    <pre
      className={cn(
        "max-h-[60vh] overflow-auto rounded-lg px-4 py-3 text-xs leading-relaxed text-gray-700 dark:text-gray-200",
        withBorder ? "border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" : "bg-transparent",
        className
      )}
    >
      <code className="block whitespace-pre">{value}</code>
    </pre>
  )
}
