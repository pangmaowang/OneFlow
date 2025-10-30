import type { TaskDefinition } from "./types"

export const dailyDeveloperRecap: TaskDefinition = {
  id: "daily-dev",
  name: "Daily developer recap",
  description: "Extract work notes, transform them with the Prompt API, and persist the recap.",
  steps: [
    {
      id: "pageContent",
      type: "read-page",
      description: "Collect the page content to summarize",
      config: {
        source: "active-tab",
        fallback:
          "Today I wrapped up the auth migration, fixed the flaky integration tests, and planned tomorrow's bug-bash for the release candidate.",
        maxLength: 6000
      }
    },
    {
      id: "recapAnalysis",
      type: "structured-prompt",
      description: "Process the captured content with the Prompt API",
      config: {
        template:
          "Format version: {{formatVersion}}\nYou are preparing a JSON summary for an engineering daily update. Rely only on the supplied notes. The response MUST be valid JSON with no Markdown, code fences, or commentary. Keep entries concise and avoid duplicate bullet points.\n\nSchema fields:\n- summary: string\n- highlights: array of string (max 5)\n- blockers: array of string (max 3, return [] when none)\n- nextFocus: array of string (max 3)\n- actionItems: array of string (max 5)\n\nRules:\n1. Only emit the JSON object defined by the schema.\n2. Trim whitespace, remove bullet prefixes, and avoid numbering.\n3. Use [] for empty lists and an empty string for summary when content is missing.\n\nNotes:\n{{input}}",
        variables: {
          formatVersion: "v1"
        },
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            highlights: {
              type: "array",
              items: { type: "string" },
              maxItems: 5
            },
            blockers: {
              type: "array",
              items: { type: "string" },
              maxItems: 3
            },
            nextFocus: {
              type: "array",
              items: { type: "string" },
              maxItems: 3
            },
            actionItems: {
              type: "array",
              items: { type: "string" },
              maxItems: 5
            }
          },
          required: ["summary", "highlights", "nextFocus"],
          additionalProperties: false
        },
        systemPrompt:
          "You are a staff engineer composing a daily async update. Provide grounded, factual summaries only.",
        outputFormat: "text",
        outputLanguage: "en",
        usePromptApi: true,
        fallbackToTemplate: true,
        coerceJsonOutput: true
      }
    },
    {
      id: "persistRecap",
      type: "store-artifact",
      description: "Persist the recap for later review",
      config: {
        artifactType: "daily-dev-recap",
        metadata: {
          presetId: "daily-dev",
          schemaVersion: "v1"
        },
        tags: ["daily", "recap", "automation"],
        parseJson: true,
        skipWhenEmpty: false
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

export const weeklySummaryReport: TaskDefinition = {
  id: "weekly-summary",
  name: "Weekly summary report",
  description: "Combine stored daily recaps into a shareable weekly update.",
  steps: [
    {
      id: "weeklySource",
      type: "collect-weekly-summary",
      description: "Gather the latest daily recaps from storage.",
      config: {
        days: 7,
        artifactType: "daily-dev-recap",
        maxEntries: 28
      }
    },
    {
      id: "weeklySynthesis",
      type: "structured-prompt",
      description: "Synthesize the weekly engineering report with the Prompt API.",
      config: {
        template:
          "You are preparing a weekly engineering status report for leadership. Summarize meaningful impact while referencing concrete details. Base your response solely on the collected daily recaps provided below. The output must be strictly valid JSON and adhere exactly to the schema. Keep each bullet punchy (under 160 characters) and avoid repetition.\n\nSchema fields:\n- summary: string\n- highlights: array of string (max 8)\n- blockers: array of string (max 5)\n- nextFocus: array of string (max 5)\n- actionItems: array of string (max 6)\n- dailyBreakdown: array of object summarizing each day\n  * date: string (human readable day label)\n  * summary: string\n  * highlights: array of string (max 5)\n  * blockers: array of string (max 5)\n  * nextFocus: array of string (max 5)\n  * actionItems: array of string (max 5)\n\nRules:\n1. Emit only the JSON object defined by the schema.\n2. Do not invent work; omit sections when there is no signal (use [] for empty lists).\n3. When citing daily details, weave them into the highlights or dailyBreakdown entries.\n\nCollected recaps:\n{{input}}",
        systemPrompt:
          "You are a staff engineering manager crafting an executive-friendly weekly update. Focus on outcomes, risks, and upcoming priorities grounded entirely in the provided notes.",
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            highlights: {
              type: "array",
              items: { type: "string" },
              maxItems: 8
            },
            blockers: {
              type: "array",
              items: { type: "string" },
              maxItems: 5
            },
            nextFocus: {
              type: "array",
              items: { type: "string" },
              maxItems: 5
            },
            actionItems: {
              type: "array",
              items: { type: "string" },
              maxItems: 6
            },
            dailyBreakdown: {
              type: "array",
              maxItems: 7,
              items: {
                type: "object",
                properties: {
                  date: { type: "string" },
                  summary: { type: "string" },
                  highlights: {
                    type: "array",
                    items: { type: "string" },
                    maxItems: 5
                  },
                  blockers: {
                    type: "array",
                    items: { type: "string" },
                    maxItems: 5
                  },
                  nextFocus: {
                    type: "array",
                    items: { type: "string" },
                    maxItems: 5
                  },
                  actionItems: {
                    type: "array",
                    items: { type: "string" },
                    maxItems: 5
                  }
                },
                required: ["date", "summary"],
                additionalProperties: false
              }
            }
          },
          required: ["summary", "highlights", "nextFocus", "dailyBreakdown"],
          additionalProperties: false
        },
        outputFormat: "text",
        usePromptApi: true,
        fallbackToTemplate: true,
        coerceJsonOutput: true,
        autoOpenViewer: false
      }
    },
    {
      id: "storeWeeklyReport",
      type: "store-artifact",
      description: "Persist the generated weekly report for future reference.",
      config: {
        artifactType: "weekly-dev-report",
        metadata: {
          presetId: "weekly-summary",
          schemaVersion: "week-v1"
        },
        tags: ["weekly", "report", "automation"],
        parseJson: true,
        skipWhenEmpty: false
      }
    }
  ]
}

export type PresetId = "daily-dev" | "page-capture" | "prompt-api-demo" | "weekly-summary"

export const PRESET_REGISTRY: Record<PresetId, TaskDefinition> = {
  "daily-dev": dailyDeveloperRecap,
  "page-capture": captureActivePage,
  "prompt-api-demo": promptApiDemo,
  "weekly-summary": weeklySummaryReport
}
