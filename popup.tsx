import { Button } from "@/components/ui/button"
import { TaskIndicator } from "@/components/ui/task-indicator"
import "./style.css"

import { cn } from "@/lib/utils"
import { ArrowRight, Bot, Cpu, PenTool, PlusCircle } from "lucide-react"
import type { LucideIcon } from "lucide-react"

type QuickAction = {
  label: string
  description: string
  icon: LucideIcon
  className?: string
  iconClassName?: string
}

const quickActions: QuickAction[] = [
  {
    label: "Daily dev recap",
    description: "Summarize commits, blockers, and upcoming priorities in seconds.",
    icon: Cpu,
    className: "border-primary/20 bg-primary/10 text-primary shadow-sm hover:bg-primary/15",
    iconClassName: "text-primary"
  },
  {
    label: "Blog autopilot",
    description: "Transform highlights into a publish-ready outline for your readers.",
    icon: PenTool,
    className: "hover:border-secondary/60 hover:bg-secondary/20",
    iconClassName: "text-secondary-foreground"
  },
  {
    label: "Add custom flow",
    description: "Stack prompts, tools, and approvals to craft your own automation.",
    icon: PlusCircle,
    className:
      "border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/40 hover:text-primary",
    iconClassName: "text-muted-foreground"
  }
]

function IndexPopup() {
  const activeRuns = 0

  return (
    <div className="w-[380px] max-w-full space-y-4 p-4">
      <header className="flex items-center justify-between rounded-2xl border bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 shadow">
            <Bot className="h-5 w-5 text-primary-foreground" />
          </span>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">Auto Boring</p>
            <p className="text-xs text-muted-foreground">Automate the work you&apos;d rather skip.</p>
          </div>
        </div>
        <TaskIndicator count={activeRuns} />
      </header>

      <section className="space-y-4 rounded-2xl border bg-card/90 p-4 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">Quick automations</h2>
          <p className="text-xs text-muted-foreground">
            Launch a ready-made routine or sketch the automation you have in mind.
          </p>
        </div>

        <div className="space-y-2">
          {quickActions.map(({ label, description, icon: Icon, className, iconClassName }) => (
            <Button
              key={label}
              variant="outline"
              size="lg"
              className={cn(
                "group h-auto w-full flex-col items-start justify-start gap-2 rounded-xl border border-border/70 bg-background/80 px-4 py-3 text-left",
                "transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm focus-visible:ring-primary/40",
                className
              )}
            >
              <div className="flex w-full items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon className={cn("h-4 w-4", iconClassName ?? "text-primary")} />
                  {label}
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
              </div>
              <span className="w-full text-xs text-muted-foreground line-clamp-2" title={description}>
                {description}
              </span>
            </Button>
          ))}
        </div>
      </section>
    </div>
  )
}

export default IndexPopup
