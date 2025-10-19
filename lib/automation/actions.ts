import type {
  ActionExecutionArgs,
  ActionExecutionResult,
  ActionType,
  ReadPageConfig,
  RegisteredAction,
  StructuredPromptConfig,
  SummarizeConfig
} from "./types"

const registry = new Map<ActionType, RegisteredAction<ActionType>>()

export function registerAction<TType extends ActionType>(
  type: TType,
  action: RegisteredAction<TType>
) {
  registry.set(type, action as unknown as RegisteredAction<ActionType>)
}

export function getAction(type: ActionType) {
  return registry.get(type)
}

export function requireAction(type: ActionType) {
  const action = getAction(type)
  if (!action) {
    throw new Error(`Action "${type}" is not registered`)
  }
  return action
}

export function listActions() {
  return Array.from(registry.entries()).map(([type, action]) => ({
    type,
    ...action
  }))
}

// --- Default actions ------------------------------------------------------

registerAction("read-page", {
  name: "Read page",
  description: "Collect content from the active page or provided source",
  run: readPageAction
})

registerAction("summarize-text", {
  name: "Summarize text",
  description: "Condense textual input into key bullet points",
  run: summarizeTextAction
})

registerAction("structured-prompt", {
  name: "Prompt template",
  description: "Render a prompt template with contextual values",
  run: structuredPromptAction
})

// --- Action implementations ----------------------------------------------

function readPageAction({ step, context }: ActionExecutionArgs<"read-page">) {
  const config: ReadPageConfig = {
    fallback: step.config?.fallback,
    source: step.config?.source,
    selector: step.config?.selector,
    attribute: step.config?.attribute,
    maxLength: step.config?.maxLength
  }

  const content = context.pageContent ?? config.fallback

  if (!content || typeof content !== "string") {
    return {
      success: false,
      error: new Error("No page content available for read-page action")
    }
  }

  const normalized =
    config.maxLength && content.length > config.maxLength
      ? `${content.slice(0, config.maxLength)}…`
      : content

  return {
    success: true,
    output: normalized,
    meta: {
      length: content.length,
      truncated: Boolean(config.maxLength && content.length > config.maxLength)
    }
  }
}

function summarizeTextAction({ input, step }: ActionExecutionArgs<"summarize-text">) {
  const config: SummarizeConfig = {
    maxSentences: step.config?.maxSentences,
    compressionRatio: step.config?.compressionRatio,
    format: step.config?.format
  }

  if (!input || typeof input !== "string") {
    return {
      success: false,
      error: new Error("summarize-text expects a string input")
    }
  }

  const sentences = input
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)

  const dynamicMax =
    config.compressionRatio && config.compressionRatio > 0 && config.compressionRatio < 1
      ? Math.max(1, Math.round(sentences.length * config.compressionRatio))
      : undefined

  const maxSentences = config.maxSentences ?? dynamicMax ?? 2
  const selected = sentences.slice(0, maxSentences)
  const summary = selected.join(" ") || input.slice(0, 280)

  const output =
    config.format === "bullets"
      ? selected.map((sentence) => `• ${sentence.trim()}`).join("\n")
      : summary.trim()

  return {
    success: true,
    output,
    meta: {
      originalSentenceCount: sentences.length,
      returnedSentenceCount: Math.min(sentences.length, maxSentences)
    }
  }
}

function structuredPromptAction({
  input,
  step,
  cache
}: ActionExecutionArgs<"structured-prompt">): ActionExecutionResult<string> {
  const config: StructuredPromptConfig = {
    template: step.config?.template ?? "{{input}}",
    variables: step.config?.variables,
    outputFormat: step.config?.outputFormat ?? "text"
  }

  const replacements = {
    input: typeof input === "string" ? input : JSON.stringify(input, null, 2),
    ...(config.variables ?? {})
  }

  const filled = config.template.replace(/{{\s*(\w+)\s*}}/g, (_, key) => {
    if (replacements[key] !== undefined) {
      return String(replacements[key])
    }

    if (cache.has(key)) {
      const value = cache.get(key)
      return typeof value === "string" ? value : JSON.stringify(value)
    }

    return `{{${key}}}`
  })

  const output =
    config.outputFormat === "json"
      ? JSON.stringify({ prompt: filled }, null, 2)
      : config.outputFormat === "markdown"
      ? `### Prompt\n\n${filled}`
      : filled

  return {
    success: true,
    output,
    meta: {
      format: config.outputFormat
    }
  }
}
