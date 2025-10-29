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

export const captureActivePage: TaskDefinition = {
  id: "page-capture",
  name: "Capture active page",
  description: "Extract and format the readable content from the current tab.",
  steps: [
    {
      id: "activePage",
      type: "read-page",
      description: "Clean up the current page content",
      config: {
        source: "active-tab",
        maxLength: 4000
      }
    }
  ]
}

export const promptApiDemo: TaskDefinition = {
  id: "prompt-api-demo",
  name: "Prompt API demo",
  description: "Call the Chrome Prompt API and return structured JSON output.",
  steps: [
    {
      id: "promptResult",
      type: "structured-prompt",
      description: "Invoke Gemini Nano with a JSON schema constraint.",
      config: {
        template:
          "You are helping a developer understand an imprecise ticket. Based on the ticket text below, produce structured guidance that fits the provided schema. Ticket:\n\n{{input}}",
        systemPrompt:
          "You are a senior engineer. Provide grounded, factual guidance without fabricating details that are not present in the ticket.",
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            suggestedClarifications: {
              type: "array",
              items: { type: "string" },
              minItems: 0,
              maxItems: 4
            },
            riskLevel: {
              type: "string",
              enum: ["low", "medium", "high"]
            },
            testPlan: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 5
            }
          },
          required: ["summary", "riskLevel", "testPlan"],
          additionalProperties: false
        },
        outputFormat: "json",
        outputLanguage: "en",
        usePromptApi: true
      }
    },
    {
      id: "persistPromptResult",
      type: "store-artifact",
      description: "Persist the structured prompt output for historical reporting.",
      config: {
        artifactType: "prompt-result",
        metadata: {
          sourceTask: "prompt-api-demo"
        },
        tags: ["prompt-api", "automation"],
        skipWhenEmpty: true
      }
    }
  ]
}

export type PresetId = "daily-dev" | "page-capture" | "prompt-api-demo"

export const PRESET_REGISTRY: Record<PresetId, TaskDefinition> = {
  "daily-dev": dailyDeveloperRecap,
  "page-capture": captureActivePage,
  "prompt-api-demo": promptApiDemo
}
