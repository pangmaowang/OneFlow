import React from "react"

import { Check, Copy } from "lucide-react"

import { cn } from "@/lib/utils"

import type { CopyState } from "../types"

type CopyButtonProps = {
  target: string
  copyState: CopyState
  onCopy: () => void
  children: React.ReactNode
  className?: string
}

export function CopyButton({ target, copyState, onCopy, children, className }: CopyButtonProps) {
  const status = copyState.target === target ? copyState.status : "idle"
  const Icon = status === "copied" ? Check : Copy
  const label = status === "copied" ? "COPIED" : String(children)

  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn(
        "inline-flex items-start gap-2 rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wider transition focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2 focus:ring-offset-white hover:text-gray-700 dark:focus:ring-gray-600 dark:focus:ring-offset-gray-900",
        status === "copied" ? "text-emerald-600 dark:text-emerald-400" : "text-gray-500 dark:text-gray-400",
        className
      )}
    >
      <Icon className="mt-0.5 h-4 w-4" aria-hidden="true" />
      <span className="pt-0.5 leading-tight">{label}</span>
    </button>
  )
}
