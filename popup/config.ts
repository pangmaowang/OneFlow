import { CalendarRange, Feather, NotebookPen, PlusCircle, Sparkles } from "lucide-react"

import type { QuickAction } from "./types"

export const PREVIEW_LIMIT = 320
export const MAX_DEBUG_ENTRIES = 8

export const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "Daily dev debrief",
    description: "Digest the ticket, capture what matters, and spin it into a shine-worthy update.",
    icon: Sparkles,
    className: "hover:border-purple-300/70 hover:bg-purple-200/20",
    iconClassName: "text-purple-500",
    presetId: "daily-dev"
  },
  {
    label: "Weekly highlight reel",
    description: "Roll up the week’s recaps into a brag-worthy briefing in one click.",
    icon: CalendarRange,
    className: "border-amber-300/60 bg-amber-200/15 text-amber-700 hover:bg-amber-200/25",
    iconClassName: "text-amber-500",
    presetId: "weekly-summary"
  },
  {
    label: "Blog research kit",
    description: "Clip any page and capture summary, tags, insights, technical angles, and source links for your blog.",
    icon: Feather,
    className: "border-sky-300/60 bg-sky-200/15 text-sky-800 hover:bg-sky-200/20",
    iconClassName: "text-sky-500",
    presetId: "blog-draft"
  },
  {
    label: "Blog weekly digest",
    description: "Blend the week’s research notes into an editorial brief with top tags, spotlights, and next angles.",
    icon: NotebookPen,
    className: "border-indigo-300/60 bg-indigo-200/15 text-indigo-800 hover:bg-indigo-200/20",
    iconClassName: "text-indigo-500",
    presetId: "blog-weekly"
  },
  {
    label: "Add custom flow",
    description: "Design your dream workflow with prompts, tools, and approvals—coming soon.",
    icon: PlusCircle,
    className:
      "border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/40 hover:text-primary",
    iconClassName: "text-muted-foreground"
  }
]
