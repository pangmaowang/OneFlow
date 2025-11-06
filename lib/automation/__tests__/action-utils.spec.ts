import { describe, it, expect, vi } from "vitest"

import {
  buildBlogCollections,
  buildBlogDigestSummary,
  buildBlogTagIndex,
  buildPreview,
  buildPromptPayload,
  buildSpotlightArticles,
  buildStoredPayload,
  buildTagSummaries,
  buildWeeklyPromptSection,
  coerceJsonLike,
  collectSupportingLinks,
  collectUniqueStrings,
  deriveRecommendedAngles,
  formatDateRange,
  formatTemplateOutput,
  normalizeBlogDigest,
  normalizeStructuredOutput,
  normalizeWeeklyRecap,
  renderPromptTemplate
} from "../utils/action-utils"
import {
  BLOG_PROMPT_DEFAULT_SCHEMA,
  DEFAULT_COLLECTION_ENTRIES_PER_TAG,
  DEFAULT_COLLECTION_LIMIT,
  DEFAULT_RECOMMENDED_ANGLES_LIMIT,
  DEFAULT_SPOTLIGHT_ARTICLE_LIMIT,
  DEFAULT_SUPPORTING_LINKS_LIMIT,
  MAX_DRAFT_SECTION_BULLETS,
  MAX_DRAFT_SECTION_COUNT
} from "../config/action-config"
import type { BlogDigestEntry } from "../action-types"
import type { StoredArtifactRecord } from "../../storage"

function createBlogEntry(overrides: Partial<BlogDigestEntry> = {}): BlogDigestEntry {
  const createdAt = overrides.createdAt ?? Date.now()
  return {
    id: overrides.id ?? `entry-${Math.random().toString(16).slice(2)}`,
    createdAt,
    dateISO: overrides.dateISO ?? new Date(createdAt).toISOString(),
    dateLabel: overrides.dateLabel ?? "Mon Jan 01",
    summary: overrides.summary ?? "Insight summary",
    tags: overrides.tags ?? [],
    keyInsights: overrides.keyInsights ?? [],
    technicalHighlights: overrides.technicalHighlights ?? [],
    narrativeDirections: overrides.narrativeDirections ?? [],
    supportingLinks: overrides.supportingLinks ?? [],
    sourceUrl: overrides.sourceUrl
  }
}

describe("prompt helpers", () => {
  it("renders templates using replacements and cache entries", () => {
    const cache = new Map<string, unknown>([["cached", { ok: true }]])
    const result = renderPromptTemplate("Hello {{name}} from {{cached}} -> {{missing}}", { name: "Ada" }, cache)

    expect(result).toBe('Hello Ada from {"ok":true} -> {{missing}}')
  })

  it("formats prompts according to the requested output format", () => {
    const markdown = formatTemplateOutput("Prompt body", "markdown")
    expect(markdown).toBe("### Prompt\n\nPrompt body")

    const json = formatTemplateOutput("Prompt body", "json")
    expect(json).toBe(JSON.stringify({ prompt: "Prompt body" }, null, 2))

    const plain = formatTemplateOutput("Prompt body", "text")
    expect(plain).toBe("Prompt body")
  })

  it("builds structured payloads when a system prompt is supplied", () => {
    const payload = buildPromptPayload("User prompt", "System guidance")
    expect(payload).toEqual([
      { role: "system", content: "System guidance" },
      { role: "user", content: "User prompt" }
    ])
  })
})

describe("json coercion", () => {
  it("parses direct JSON strings and reports the source", () => {
    const result = coerceJsonLike('{"a":1}')
    expect(result.parsed).toEqual({ a: 1 })
    expect(result.source).toBe("direct")
  })

  it("parses fenced JSON blocks", () => {
    const result = coerceJsonLike('```json\n{"b":2}\n```')
    expect(result.parsed).toEqual({ b: 2 })
    expect(result.source).toBe("fenced")
  })

  it("parses balanced JSON fragments embedded in text", () => {
    const result = coerceJsonLike('Noise before {"c":3}')
    expect(result.parsed).toEqual({ c: 3 })
    expect(result.source).toBe("balanced")
  })

  it("falls back to trimmed text when parsing fails", () => {
    const result = coerceJsonLike("not json")
    expect(result.parsed).toBeUndefined()
    expect(result.text).toBe("not json")
    expect(result.source).toBe("trimmed")
  })
})

describe("structured normalization", () => {
  it("normalizes configured string and array fields, including draft details", () => {
    const normalized = normalizeStructuredOutput(
      {
        summary: "  Status update  ",
        highlights: ["Shipped feature", { text: "Resolved incident" }, "Shipped feature"],
        tags: ["  delivery  ", "observability", "delivery"],
        suggestedClarifications: { question: " Follow-up? " },
        draftPullRequest: {
          title: ["  Release notes  "],
          content: { text: "Added new telemetry" },
          potentialRegressions: [
            "Auth",
            "Billing",
            "Billing",
            "Metrics",
            "Dashboards",
            "Notifications"
          ],
          blastRadius: { text: " Core services " },
          testPlan: [" Smoke tests "],
          extra: "remove"
        },
        draftSections: [
          {
            heading: "  Highlights  ",
            bullets: ["- Item one", { text: "Item two" }]
          },
          "Loose heading",
          {
            heading: "Deep dive",
            bullets: Array.from({ length: MAX_DRAFT_SECTION_BULLETS + 2 }, (_, index) => `Point ${index}`)
          },
          ...Array.from({ length: MAX_DRAFT_SECTION_COUNT }, (_, index) => `Overflow ${index}`)
        ]
      },
      BLOG_PROMPT_DEFAULT_SCHEMA
    )

    expect(normalized.changed).toBe(true)
    const value = normalized.value as Record<string, unknown>

    expect(value.summary).toBe("Status update")
    expect(value.highlights).toEqual(["Shipped feature", "Resolved incident"])
    expect(value.tags).toEqual(["delivery", "observability"])
    expect(value.suggestedClarifications).toEqual(["Follow-up?"])

    const draft = value.draftPullRequest as Record<string, unknown>
    expect(draft.title).toBe("Release notes")
    expect(draft.content).toBe("Added new telemetry")
    expect(draft.potentialRegressions).toEqual(["Auth", "Billing", "Metrics", "Dashboards", "Notifications"])
    expect(draft.blastRadius).toBe("Core services")
    expect(draft.testPlan).toBe("Smoke tests")
    expect(Object.keys(draft)).not.toContain("extra")

    const sections = value.draftSections as Array<{ heading: string; bullets: string[] }>
    expect(sections).toHaveLength(MAX_DRAFT_SECTION_COUNT)
    expect(sections[0]).toEqual({ heading: "Highlights", bullets: ["Item one", "Item two"] })
    expect(sections[1]).toEqual({ heading: "Loose heading", bullets: [] })
    expect(sections[2].bullets).toHaveLength(MAX_DRAFT_SECTION_BULLETS)

    const modified = new Set(normalized.modifiedFields)
    const requiredFields = [
      "summary",
      "highlights",
      "tags",
      "suggestedClarifications",
      "draftPullRequest.title",
      "draftPullRequest.content",
      "draftPullRequest.potentialRegressions",
      "draftPullRequest.blastRadius",
      "draftPullRequest.testPlan",
      "draftPullRequest.extra",
      "draftSections.heading",
      "draftSections.bullets"
    ]
    requiredFields.forEach((field) => {
      expect(modified.has(field)).toBe(true)
    })
  })

  it("returns the original value unchanged when nothing can be normalized", () => {
    const unchanged = { message: "noop" }
    const normalized = normalizeStructuredOutput(unchanged)
    expect(normalized.changed).toBe(false)
    expect(normalized.value).toBe(unchanged)
  })
})

describe("preview helpers", () => {
  it("truncates previews that exceed the specified limit", () => {
    const preview = buildPreview("a".repeat(20), 10)
    expect(preview).toBe("aaaaaaaaaa…")
  })

  it("formats weekly prompt sections", () => {
    const entry = {
      id: "recap-1",
      createdAt: Date.now(),
      dateISO: new Date().toISOString(),
      dateLabel: "Mon Jan 01",
      summary: "Summary",
      highlights: [],
      blockers: ["Blocker"],
      nextFocus: ["Next"],
      actionItems: []
    }

    const section = buildWeeklyPromptSection(entry, 1)
    expect(section).toContain("Entry 1: Mon Jan 01")
    expect(section).toContain("Blockers:\n- Blocker")
  })

  it("formats date ranges", () => {
    const start = Date.UTC(2024, 0, 1)
    const end = Date.UTC(2024, 0, 3)
    const range = formatDateRange(start, end)
    expect(range).toMatch(/Jan/) // locale dependent but should include month label
  })
})

describe("artifact normalization", () => {
  it("normalizes daily recap artifacts and falls back to highlights when summary is missing", () => {
    const now = Date.now()
    const record: StoredArtifactRecord = {
      id: "recap",
      type: "daily-dev-recap",
      createdAt: now,
      payload: {
        raw: JSON.stringify({
          highlights: ["Resolved incidents"],
          blockers: ["Deploy freeze"],
          nextFocus: [],
          actionItems: []
        })
      }
    }

    const normalized = normalizeWeeklyRecap(record)
    expect(normalized).not.toBeNull()
    expect(normalized?.summary).toBe("Resolved incidents")
    expect(normalized?.dateISO).toBe(new Date(now).toISOString())
  })

  it("normalizes blog digest artifacts and trims strings", () => {
    const now = Date.now()
    const record: StoredArtifactRecord = {
      id: "digest",
      type: "blog-research-note",
      createdAt: now,
      payload: {
        raw: JSON.stringify({
          summary: "  Observability for AI  ",
          tags: ["  tracing  ", "ai"],
          keyInsights: ["Trace everything"],
          technicalHighlights: ["OpenTelemetry"],
          narrativeDirections: ["Case study"],
          supportingLinks: [" https://example.com "],
          sourceUrl: " https://example.com/source "
        })
      }
    }

    const normalized = normalizeBlogDigest(record)
    expect(normalized).not.toBeNull()
    expect(normalized?.summary).toBe("Observability for AI")
    expect(normalized?.tags).toEqual(["tracing", "ai"])
    expect(normalized?.sourceUrl).toBe("https://example.com/source")
  })

  it("returns null when a digest artifact cannot be parsed", () => {
    const record: StoredArtifactRecord = {
      id: "invalid",
      type: "blog-research-note",
      createdAt: Date.now(),
      payload: {
        raw: "not json"
      }
    }

    expect(normalizeBlogDigest(record)).toBeNull()
  })
})

describe("digest helpers", () => {
  it("indexes blog entries by tag and handles untagged items", () => {
    const base = Date.now()
    const entries = [
      createBlogEntry({ createdAt: base, tags: [] }),
      createBlogEntry({ createdAt: base + 1000, tags: ["design"] }),
      createBlogEntry({ createdAt: base + 2000, tags: ["design", "ux"] })
    ]

    const index = buildBlogTagIndex(entries)
    expect(index.get("__untagged__")?.length).toBe(1)
    expect(index.get("design")?.map((entry) => entry.createdAt)).toEqual([base + 1000, base + 2000])
    expect(index.get("ux")?.length).toBe(1)
  })

  it("summarizes tags in descending order of frequency", () => {
    const index = new Map<string, BlogDigestEntry[]>([
      ["observability", [createBlogEntry(), createBlogEntry()]],
      ["ai", [createBlogEntry()]],
      ["__untagged__", [createBlogEntry()]]
    ])

    const summaries = buildTagSummaries(index)
    expect(summaries).toEqual([
      { tag: "observability", count: 2 },
      { tag: "ai", count: 1 }
    ])
  })

  it("builds human readable digest summaries", () => {
    const summary = buildBlogDigestSummary({
      noteCount: 3,
      uniqueTagCount: 2,
      rangeLabel: "Jan 1 – Jan 7",
      tagSummaries: [
        { tag: "observability", count: 2 },
        { tag: "ai", count: 1 }
      ]
    })

    expect(summary).toContain("Captured 3 research notes")
    expect(summary).toContain("observability (2)")
  })

  it("builds spotlight articles using the most recent entries", () => {
    const base = Date.now()
    const entries = Array.from({ length: DEFAULT_SPOTLIGHT_ARTICLE_LIMIT + 2 }, (_, index) =>
      createBlogEntry({
        createdAt: base - index * 1000,
        summary: index === 0 ? "Latest" : "",
        keyInsights: index === 0 ? [] : ["Fallback"],
        narrativeDirections: ["Angle"],
        supportingLinks: [`https://example.com/${index}`]
      })
    )

    const spotlights = buildSpotlightArticles(entries)
    expect(spotlights).toHaveLength(DEFAULT_SPOTLIGHT_ARTICLE_LIMIT)
    expect(spotlights[0].summary).toBe("Latest")
    expect(spotlights[1].summary).toBe("Fallback")
  })

  it("builds tag collections with synopsis and entry limits", () => {
    const base = Date.now()
    const index = new Map<string, BlogDigestEntry[]>([
      [
        "design",
        [
          createBlogEntry({ createdAt: base - 3000, summary: "Early", keyInsights: ["Insight"] }),
          createBlogEntry({ createdAt: base - 2000, summary: "Mid" }),
          createBlogEntry({ createdAt: base - 1000, summary: "Latest" })
        ]
      ],
      ["ai", [createBlogEntry({ createdAt: base - 1500, keyInsights: ["Primary"] })]]
    ])

    const collections = buildBlogCollections(index, DEFAULT_COLLECTION_LIMIT, DEFAULT_COLLECTION_ENTRIES_PER_TAG)
    expect(collections).toHaveLength(2)
    const design = collections.find((collection) => collection.tag === "design")
    expect(design?.entries.length).toBeLessThanOrEqual(DEFAULT_COLLECTION_ENTRIES_PER_TAG)
    expect(design?.synopsis).toContain("notes captured")
  })

  it("derives recommended angles without duplicates and up to the configured limit", () => {
    const entries = [
      createBlogEntry({ narrativeDirections: ["Angle A", "Angle B", "Angle A"] }),
      createBlogEntry({ narrativeDirections: ["Angle C"] })
    ]

    const angles = deriveRecommendedAngles(entries, DEFAULT_RECOMMENDED_ANGLES_LIMIT)
    expect(angles).toEqual(["Angle A", "Angle B", "Angle C"])
  })

  it("collects supporting links in reverse chronological order without duplicates", () => {
    const base = Date.now()
    const entries = [
      createBlogEntry({
        createdAt: base - 1000,
        supportingLinks: ["https://example.com/a", "https://example.com/b"],
        sourceUrl: "https://example.com/source"
      }),
      createBlogEntry({
        createdAt: base,
        supportingLinks: ["https://example.com/b", "https://example.com/c"]
      })
    ]

    const links = collectSupportingLinks(entries, DEFAULT_SUPPORTING_LINKS_LIMIT)
    expect(links).toEqual(["https://example.com/b", "https://example.com/c", "https://example.com/a", "https://example.com/source"])
  })
})

describe("utility helpers", () => {
  it("collects unique strings while respecting limits", () => {
    const values = [" one ", "one", "two", " two ", "three", ""]
    const result = collectUniqueStrings(values, 3)
    expect(result).toEqual(["one", "two", "three"])
  })

  it("builds stored payloads for strings and objects", () => {
    const onParseError = vi.fn()
    const parsed = buildStoredPayload('{"foo":1}', true, onParseError)
    expect(parsed.raw).toBe('{"foo":1}')
    expect(parsed.parsed).toEqual({ foo: 1 })

    const errored = buildStoredPayload("invalid", true, onParseError)
    expect(errored.parsed).toBeUndefined()
    expect(onParseError).toHaveBeenCalledTimes(1)

    const objectPayload = buildStoredPayload({ bar: 2 }, false)
    expect(objectPayload.raw).toContain('"bar": 2')
    expect(objectPayload.parsed).toEqual({ bar: 2 })
  })
})
