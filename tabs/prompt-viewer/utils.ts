export function formatKeyLabel(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/^./, (char) => char.toUpperCase())
}

export function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function sanitizeFileSegment(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || "automation-result"
}

export function buildExportTimestamp(createdAt?: number) {
  const source = createdAt ? new Date(createdAt) : new Date()
  return source.toISOString().replace(/[:.]/g, "-")
}

export function normalizeStringList(value: unknown): string[] {
  const unique = new Set<string>()

  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
        const normalized = String(item).trim()
        if (normalized) {
          unique.add(normalized)
        }
      } else if (item && typeof item === "object") {
        normalizeStringList(item).forEach((entry) => unique.add(entry))
      }
    })
    return Array.from(unique)
  }

  if (typeof value === "string") {
    value
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((entry) => unique.add(entry))
    return Array.from(unique)
  }

  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => {
      if (typeof item === "string") {
        const normalized = item.trim()
        if (normalized) {
          unique.add(normalized)
        }
      }
    })
    return Array.from(unique)
  }

  return []
}
