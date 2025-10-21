export const READ_PAGE_MESSAGE = "auto-boring:read-page"

export type ExtractionOptions = {
  selector?: string | null
  attribute?: string | null
}

export type ExtractionResult = {
  title?: string
  url?: string
  body: string
  selection?: string
  rawLength: number
  selectionLength: number
  containerTag?: string
}

export type ReadPageRequest = {
  type: typeof READ_PAGE_MESSAGE
  selector?: string | null
  attribute?: string | null
}

export type ReadPageResponse = {
  success: boolean
  payload?: ExtractionResult
  error?: string
}

const IGNORED_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "canvas",
  "svg",
  "link",
  "meta",
  "form",
  "button",
  "input",
  "nav",
  "header",
  "footer",
  "aside"
]

const FALLBACK_SELECTORS = [
  "article",
  "main",
  "[role=main]",
  "#main",
  ".post",
  ".content",
  "body"
]

export function extractDocumentContent(doc: Document, options: ExtractionOptions = {}): ExtractionResult {
  const selectionText = getSelectionText(doc)
  const candidateSelectors = buildCandidateSelectors(options)
  const container = findContentContainer(doc, candidateSelectors) ?? doc.body ?? doc.documentElement

  if (!container) {
    return buildFallbackResult(doc, selectionText)
  }

  const prepared = cloneAndPrepareContainer(doc, container)
  if (!prepared) {
    return buildFallbackResult(doc, selectionText)
  }

  const attributeValue = readAttributeValue(prepared, options.attribute)
  const collected = attributeValue || collectTextFromNode(doc, prepared)
  const fallbackBody = collected || getDocumentFallback(doc)

  const normalizedBody = normalizeExtractedText(fallbackBody)

  return buildExtractionResult({
    doc,
    body: normalizedBody,
    rawSource: fallbackBody,
    selectionText,
    containerTag: container.tagName?.toLowerCase()
  })
}

function getSelectionText(doc: Document) {
  return doc.defaultView?.getSelection?.()?.toString().trim() ?? ""
}

function buildCandidateSelectors(options: ExtractionOptions) {
  return [options.selector ?? null, ...FALLBACK_SELECTORS].filter(
    (value): value is string => Boolean(value)
  )
}

function findContentContainer(doc: Document, selectors: string[]) {
  for (const selector of selectors) {
    const candidate = doc.querySelector(selector)
    if (candidate && hasMeaningfulText(candidate)) {
      return candidate
    }
  }

  return null
}

function hasMeaningfulText(element: Element) {
  const text = element.textContent?.trim() ?? ""
  return text.length > 120
}

function cloneAndPrepareContainer(doc: Document, container: Element) {
  const cloned = container.cloneNode(true) as HTMLElement | null
  if (!cloned) {
    return null
  }

  pruneIgnoredSelectors(cloned)
  return cloned
}

function pruneIgnoredSelectors(root: HTMLElement) {
  for (const selector of IGNORED_SELECTORS) {
    root.querySelectorAll(selector).forEach((node) => node.remove())
  }
}

function readAttributeValue(element: HTMLElement, attribute?: string | null) {
  if (typeof attribute !== "string" || !attribute.trim()) {
    return ""
  }

  return element.getAttribute(attribute.trim()) ?? ""
}

function collectTextFromNode(doc: Document, root: HTMLElement) {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const value = node.textContent ?? ""
      return value.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })

  const parts: string[] = []
  while (walker.nextNode()) {
    const value = walker.currentNode?.textContent ?? ""
    const normalized = value.replace(/\s+/g, " ").trim()
    if (normalized) {
      parts.push(normalized)
    }
  }

  return parts.join("\n")
}

function getDocumentFallback(doc: Document) {
  return doc.body?.innerText ?? ""
}

function buildFallbackResult(doc: Document, selectionText: string): ExtractionResult {
  const fallbackBody = getDocumentFallback(doc)
  return buildExtractionResult({
    doc,
    body: normalizeExtractedText(fallbackBody),
    rawSource: fallbackBody,
    selectionText
  })
}

function buildExtractionResult({
  doc,
  body,
  rawSource,
  selectionText,
  containerTag
}: {
  doc: Document
  body: string
  rawSource: string
  selectionText: string
  containerTag?: string
}): ExtractionResult {
  return {
    title: doc.title ?? "",
    url: doc.location?.href,
    body,
    selection: selectionText,
    rawLength: rawSource.length,
    selectionLength: selectionText.length,
    containerTag
  }
}

export function normalizeExtractedText(value: string) {
  return value
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
}

export function sanitizeHtmlFragment(value: string) {
  const withoutScripts = value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?>[\s\S]*?<\/noscript>/gi, "")

  const stripped = withoutScripts.replace(/<[^>]+>/g, " ")
  const fallback = stripped.trim() ? stripped : value
  return normalizeExtractedText(fallback)
}

export function formatExtractedContent({
  title,
  url,
  body
}: {
  title?: string
  url?: string
  body: string
}) {
  const lines: string[] = []

  if (title && title.trim()) {
    lines.push(`# ${title.trim()}`)
  }

  if (url && url.trim()) {
    lines.push(`URL: ${url.trim()}`)
  }

  const paragraphs = body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (paragraphs.length > 0) {
    if (lines.length > 0) {
      lines.push("")
    }

    lines.push(...paragraphs)
  }

  return lines.join("\n") || body
}
