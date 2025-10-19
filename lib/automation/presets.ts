import type { TaskDefinition } from "./types"

export const dailyDeveloperRecap: TaskDefinition = {
  id: "daily-dev",
  name: "Daily developer recap",
  description: "Summarize recent work and generate a recap outline.",
  steps: [
    {
      id: "pageContent",
      type: "read-page",
      description: "Collect the page content to summarize",
      config: {
        source: "active-tab",
        fallback:
          "Today I wrapped up the auth migration, fixed the flaky integration tests, and planned tomorrow's bug-bash for the release candidate.",
        maxLength: 4000
      }
    },
    {
      id: "summary",
      type: "summarize-text",
      description: "Summarize the captured content",
      config: {
        maxSentences: 2
      }
    },
    {
      id: "prompt",
      type: "structured-prompt",
      description: "Generate a recap prompt ready for an LLM",
      config: {
        template:
          "Daily standup recap:\nHighlights: {{summary}}\nNext focus: Ensure deployment readiness and monitor analytics pipeline.",
        variables: {
          title: "Daily standup recap"
        },
        outputFormat: "markdown"
      }
    }
  ]
}

export type PresetId = "daily-dev"

export const PRESET_REGISTRY: Record<PresetId, TaskDefinition> = {
  "daily-dev": dailyDeveloperRecap
}
