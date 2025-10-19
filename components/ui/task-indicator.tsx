import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { ListChecks } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type TaskIndicatorProps = {
  count?: number
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  icon?: LucideIcon
  label?: string
  className?: string
}

/**
 * Compact status button to surface active automations.
 */
export function TaskIndicator({
  count = 0,
  onClick,
  icon: Icon = ListChecks,
  label = "View active runs",
  className
}: TaskIndicatorProps) {
  const displayCount = count > 9 ? "9+" : count

  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon" }),
        "relative border border-dashed border-primary/40 bg-primary/5 text-primary hover:bg-primary/10",
        className
      )}
      onClick={onClick}
    >
      <Icon aria-hidden className="h-4 w-4" />
      <span className="sr-only">{label}</span>
      {count > 0 ? (
        <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground shadow-sm">
          {displayCount}
        </span>
      ) : null}
    </button>
  )
}
