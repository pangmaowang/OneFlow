import { describe, it, expect } from "vitest"

import {
  ACTION_METADATA,
  BLOG_DIGEST_MAX_ENTRIES_MULTIPLIER,
  BLOG_DIGEST_TOP_TAGS_LIMIT,
  BLOG_PROMPT_DEFAULT_FORMAT,
  BLOG_PROMPT_DEFAULT_SCHEMA,
  BLOG_PROMPT_DEFAULT_TEMPLATE,
  DAY_IN_MS,
  DEFAULT_BLOG_DIGEST_DAYS,
  DEFAULT_COLLECTION_ENTRIES_PER_TAG,
  DEFAULT_COLLECTION_LIMIT,
  DEFAULT_RECOMMENDED_ANGLES_LIMIT,
  DEFAULT_SPOTLIGHT_ARTICLE_LIMIT,
  DEFAULT_SUPPORTING_LINKS_LIMIT,
  DEFAULT_WEEKLY_SUMMARY_DAYS,
  KNOWN_STRING_ARRAY_FIELDS,
  KNOWN_STRING_FIELDS,
  MAX_DRAFT_SECTION_BULLETS,
  MAX_DRAFT_SECTION_COUNT,
  WEEKLY_SUMMARY_MAX_ENTRIES_MULTIPLIER
} from "../config/action-config"
import type { ActionType } from "../types"

describe("action-config", () => {
  it("includes metadata for every registered action", () => {
    const expected: ActionType[] = [
      "read-page",
      "collect-weekly-summary",
      "structured-prompt",
      "blog-prompt",
      "collect-blog-digest",
      "store-artifact"
    ]

    expect(new Set(Object.keys(ACTION_METADATA))).toEqual(new Set(expected))
    expected.forEach((type) => {
      const entry = ACTION_METADATA[type]
      expect(entry).toBeDefined()
      expect(entry.name.trim().length).toBeGreaterThan(0)
      expect(entry.description.trim().length).toBeGreaterThan(0)
    })
  })

  it("defines consistent numeric defaults", () => {
    expect(DAY_IN_MS).toBe(24 * 60 * 60 * 1000)
    expect(DEFAULT_WEEKLY_SUMMARY_DAYS).toBeGreaterThan(0)
    expect(WEEKLY_SUMMARY_MAX_ENTRIES_MULTIPLIER).toBeGreaterThanOrEqual(1)

    expect(DEFAULT_BLOG_DIGEST_DAYS).toBeGreaterThan(0)
    expect(BLOG_DIGEST_MAX_ENTRIES_MULTIPLIER).toBeGreaterThanOrEqual(1)
    expect(BLOG_DIGEST_TOP_TAGS_LIMIT).toBeGreaterThan(0)

    expect(DEFAULT_SPOTLIGHT_ARTICLE_LIMIT).toBeGreaterThan(0)
    expect(DEFAULT_COLLECTION_LIMIT).toBeGreaterThan(0)
    expect(DEFAULT_COLLECTION_ENTRIES_PER_TAG).toBeGreaterThan(0)
    expect(DEFAULT_RECOMMENDED_ANGLES_LIMIT).toBeGreaterThan(0)
    expect(DEFAULT_SUPPORTING_LINKS_LIMIT).toBeGreaterThan(0)

    expect(MAX_DRAFT_SECTION_COUNT).toBeGreaterThan(0)
    expect(MAX_DRAFT_SECTION_BULLETS).toBeGreaterThan(0)
  })

  it("provides a structured blog prompt template and schema", () => {
    expect(BLOG_PROMPT_DEFAULT_FORMAT).toBe("blog-v3")
    expect(BLOG_PROMPT_DEFAULT_TEMPLATE).toContain("{{formatVersion}}")
    expect(BLOG_PROMPT_DEFAULT_TEMPLATE).toContain("Schema fields:")

    const schema = BLOG_PROMPT_DEFAULT_SCHEMA as { required?: string[]; properties?: Record<string, unknown> }
    expect(schema.required).toEqual(expect.arrayContaining(["summary", "tags", "keyInsights", "sourceUrl"]))
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["summary", "tags", "keyInsights", "technicalHighlights", "narrativeDirections", "supportingLinks", "sourceUrl"])
    )
  })

  it("tracks known string and string array fields for normalization", () => {
    expect(Array.isArray(KNOWN_STRING_FIELDS)).toBe(true)
    expect(Array.isArray(KNOWN_STRING_ARRAY_FIELDS)).toBe(true)
    const uniqueStrings = new Set([...KNOWN_STRING_FIELDS, ...KNOWN_STRING_ARRAY_FIELDS])
    expect(uniqueStrings.size).toBe(KNOWN_STRING_FIELDS.length + KNOWN_STRING_ARRAY_FIELDS.length)
  })
})
