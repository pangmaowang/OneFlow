import type { ActionType } from "../types"

export const ACTION_METADATA: Record<ActionType, { name: string; description: string }> = {
  "read-page": {
    name: "Read page",
    description: "Collect content from the active page or provided source"
  },
  "collect-weekly-summary": {
    name: "Collect weekly recaps",
    description: "Gather stored daily recaps for weekly reporting"
  },
  "structured-prompt": {
    name: "Prompt template",
    description: "Render a prompt template with contextual values"
  },
  "blog-prompt": {
    name: "Blog prompt",
    description: "Extract blog-ready research notes from captured content"
  },
  "collect-blog-digest": {
    name: "Collect blog research",
    description: "Gather stored blog research notes for weekly synthesis"
  },
  "store-artifact": {
    name: "Store artifact",
    description: "Persist automation output for future recall"
  }
}

export const DAY_IN_MS = 86_400_000

export const DEFAULT_WEEKLY_SUMMARY_DAYS = 7
export const WEEKLY_SUMMARY_MAX_ENTRIES_MULTIPLIER = 3

export const DEFAULT_BLOG_DIGEST_DAYS = 7
export const BLOG_DIGEST_MAX_ENTRIES_MULTIPLIER = 6
export const BLOG_DIGEST_TOP_TAGS_LIMIT = 6

export const BLOG_PROMPT_DEFAULT_FORMAT = "blog-v3"

export const BLOG_PROMPT_DEFAULT_TEMPLATE = `Format version: {{formatVersion}}
You are compiling research notes for a future blog post. Study only the supplied page content and distill it into the JSON schema below. The response MUST be valid JSON with no commentary and no markdown code fences.

Schema fields:
- summary: string (2-3 sentences capturing the page's core idea)
- tags: array of string (2-3 concise, lowercase slugs that cluster the topic)
- keyInsights: array of string (max 6, succinct takeaways)
- technicalHighlights: array of string (max 6, noteworthy technologies, APIs, or data points)
- narrativeDirections: array of string (max 4, suggested angles or outlines for the post)
- supportingLinks: array of string (max 4, absolute URLs worth revisiting)
- sourceUrl: string (the canonical URL for the captured page, empty string when unavailable)

Rules:
1. Emit only the JSON object with the schema above.
2. Trim whitespace, remove numbering or bullet prefixes, and deduplicate entries.
3. Use [] for empty lists and an empty string when information is missing.
4. For tags, cite 2-3 short identifiers that would help group this article with similar themes (use hyphenated slugs when possible).
5. If the provided content includes a line beginning with "URL:", reuse that value for sourceUrl.
6. Preserve factual accuracy—do not invent details beyond the source content.

Page content:
{{input}}`

export const BLOG_PROMPT_DEFAULT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: { type: "string" },
    tags: {
      type: "array",
      items: { type: "string" },
      minItems: 2,
      maxItems: 3
    },
    keyInsights: {
      type: "array",
      items: { type: "string" },
      maxItems: 6
    },
    technicalHighlights: {
      type: "array",
      items: { type: "string" },
      maxItems: 6
    },
    narrativeDirections: {
      type: "array",
      items: { type: "string" },
      maxItems: 4
    },
    supportingLinks: {
      type: "array",
      items: { type: "string" },
      maxItems: 4
    },
    sourceUrl: { type: "string" }
  },
  required: ["summary", "tags", "keyInsights", "sourceUrl"],
  additionalProperties: false
}

export const KNOWN_STRING_FIELDS = ["summary", "sourceUrl"] as const

export const KNOWN_STRING_ARRAY_FIELDS = [
  "highlights",
  "blockers",
  "nextFocus",
  "actionItems",
  "suggestedClarifications",
  "testPlan",
  "tags",
  "keyInsights",
  "technicalHighlights",
  "narrativeDirections",
  "supportingLinks"
] as const

export const MAX_DRAFT_SECTION_COUNT = 6
export const MAX_DRAFT_SECTION_BULLETS = 8

export const DEFAULT_SPOTLIGHT_ARTICLE_LIMIT = 3
export const DEFAULT_COLLECTION_LIMIT = 6
export const DEFAULT_COLLECTION_ENTRIES_PER_TAG = 6
export const DEFAULT_RECOMMENDED_ANGLES_LIMIT = 6
export const DEFAULT_SUPPORTING_LINKS_LIMIT = 12
