import type { TaskDefinition } from "./types"

export const dailyDeveloperRecap: TaskDefinition = {
  id: "daily-dev",
  name: "Daily dev debrief",
  description: "Digest the ticket, capture what matters, and spin it into a shine-worthy update.",
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
      description: "Process the content with AI",
      config: {
        template:
          "Format version: {{formatVersion}}\nYou are preparing a JSON summary for an engineering daily update. Rely only on the supplied notes. The response MUST be valid JSON with no Markdown, code fences, or commentary. Keep entries concise and avoid duplicate bullet points.\n\nSchema fields:\n- summary: string\n- highlights: array of string (max 5)\n- suggestedClarifications: array of string (max 5, use [] when none)\n- blockers: array of string (max 3, return [] when none)\n- nextFocus: array of string (max 3)\n- testPlan: array of string (max 5, outline validations)\n- actionItems: array of string (max 5)\n- draftPullRequest: object\n  * title: string\n  * content: string (multi-line body permitted)\n  * potentialRegressions: array of string (max 5, use [] when none)\n  * blastRadius: string (note the impacted areas)\n  * testPlan: string (Markdown-ready, can be multi-line)\n\nRules:\n1. Only emit the JSON object defined by the schema.\n2. Trim whitespace, remove bullet prefixes, and avoid numbering.\n3. Use [] for empty lists and an empty string for text fields when content is missing.\n4. Populate suggestedClarifications with concrete questions or leave [] when no clarifications are needed.\n5. Keep draftPullRequest factual, scoped to the supplied work, and avoid repeating earlier bullet points; always include a testPlan section even if it states \"No tests required\".\n\nNotes:\n{{input}}",
        variables: {
          formatVersion: "v2"
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
            suggestedClarifications: {
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
            testPlan: {
              type: "array",
              items: { type: "string" },
              maxItems: 5
            },
            actionItems: {
              type: "array",
              items: { type: "string" },
              maxItems: 5
            },
            draftPullRequest: {
              type: "object",
              properties: {
                title: { type: "string" },
                content: { type: "string" },
                potentialRegressions: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 5
                },
                blastRadius: { type: "string" },
                testPlan: { type: "string" }
              },
              required: ["title", "content", "testPlan"],
              additionalProperties: false
            }
          },
          required: [
            "summary",
            "highlights",
            "suggestedClarifications",
            "nextFocus",
            "testPlan",
            "draftPullRequest"
          ],
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
          schemaVersion: "v2"
        },
        tags: ["daily", "recap", "automation"],
        parseJson: true,
        skipWhenEmpty: false
      }
    }
  ]
}

export const weeklySummaryReport: TaskDefinition = {
  id: "weekly-summary",
  name: "Weekly highlight reel",
  description: "Bundle daily recaps into a leadership-ready briefing that spotlights impact and risks.",
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
      description: "Synthesize the weekly report with AI.",
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
  ]
}

export const blogResearchCapture: TaskDefinition = {
  id: "blog-draft",
  name: "Blog research capture",
  description: "Clip a page, extract reusable blog notes, and stash them for the next writing sprint.",
  steps: [
    {
      id: "blogSource",
      type: "read-page",
      description: "Collect the page content to analyze for the blog brief.",
      config: {
        source: "active-tab",
        fallback:
          "Title: Building resilient UI systems\nHighlights: layering design tokens, handling async loading states, side effects, and offline fallbacks.",
        maxLength: 8000
      }
    },
    {
      id: "blogPrompt",
      type: "blog-prompt",
      description: "Distill the captured content into structured blog notes with AI.",
      config: {
        variables: {
          formatVersion: "blog-v3"
        },
        systemPrompt:
          "You are a staff content strategist preparing research notes for a technical blog. Surface practical insights without fabricating details.",
        autoOpenViewer: false
      }
    },
    {
      id: "storeBlogNotes",
      type: "store-artifact",
      description: "Persist the structured blog notes for later drafting.",
      config: {
        artifactType: "blog-research-note",
        metadata: {
          presetId: "blog-draft",
          schemaVersion: "blog-v3"
        },
        tags: ["blog", "research", "automation"],
        parseJson: true,
        skipWhenEmpty: false
      }
    }
  ]
}

export const blogWeeklyDigest: TaskDefinition = {
  id: "blog-weekly",
  name: "Blog weekly digest",
  description: "Roll up stored blog research notes into a polished weekly briefing ready for planning.",
  steps: [
    {
      id: "blogCollection",
      type: "collect-blog-digest",
      description: "Gather the latest blog research artifacts from storage.",
      config: {
        days: 7,
        artifactType: "blog-research-note",
        maxEntries: 60,
        topTagsLimit: 6
      }
    }
  ]
}

export type PresetId = "daily-dev" | "weekly-summary" | "blog-draft" | "blog-weekly"

export const PRESET_REGISTRY: Record<PresetId, TaskDefinition> = {
  "daily-dev": dailyDeveloperRecap,
  "weekly-summary": weeklySummaryReport,
  "blog-draft": blogResearchCapture,
  "blog-weekly": blogWeeklyDigest
}
