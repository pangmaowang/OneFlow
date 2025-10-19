export type ActionContext = {
  /**
   * Raw page content or other contextual payloads available to actions.
   */
  pageContent?: string
  /**
   * Additional values that actions may read.
   */
  metadata?: Record<string, unknown>
}

export type ReadPageConfig = {
  /** Where to pull content from when the action executes. */
  source?: "active-tab" | "selection" | "html"
  /** Optional CSS selector to scope extraction. */
  selector?: string
  /** Optional attribute to read from the selector (defaults to textContent). */
  attribute?: string
  /** Upper bound on characters to return; trims if exceeded. */
  maxLength?: number
  /** Fallback string used when no content is available. */
  fallback?: string
}

export type SummarizeConfig = {
  /** Maximum number of sentences to include. */
  maxSentences?: number
  /** Target reduction ratio (0-1) used when sentence count is unavailable. */
  compressionRatio?: number
  /** Whether to return bullet points instead of a paragraph summary. */
  format?: "paragraph" | "bullets"
}

export type StructuredPromptConfig = {
  /** Prompt template that supports {{placeholders}}. */
  template: string
  /** Name/value pairs for static substitutions. */
  variables?: Record<string, string>
  /** Desired output formatting hint. */
  outputFormat?: "text" | "markdown" | "json"
}

export type ActionType = "read-page" | "summarize-text" | "structured-prompt"

export interface ActionTypeConfigMap {
  "read-page": ReadPageConfig
  "summarize-text": SummarizeConfig
  "structured-prompt": StructuredPromptConfig
}

type ActionStepBase<TType extends ActionType> = {
  id?: string
  type: TType
  config?: ActionTypeConfigMap[TType]
  description?: string
}

export type AutomationStep = {
  [Type in ActionType]: ActionStepBase<Type>
}[ActionType]

export type ActionExecutionArgs<TType extends ActionType = ActionType> = {
  step: Extract<AutomationStep, { type: TType }>
  input: unknown
  context: ActionContext
  cache: Map<string, unknown>
  signal?: AbortSignal
  setProgress?: (progress: number) => void
}

export type ActionExecutionResult<TOutput = unknown> = {
  success: boolean
  output?: TOutput
  meta?: Record<string, unknown>
  error?: Error
}

export type ActionHandler<TType extends ActionType = ActionType, TOutput = unknown> = (
  args: ActionExecutionArgs<TType>
) => Promise<ActionExecutionResult<TOutput>> | ActionExecutionResult<TOutput>

export type RegisteredAction<TType extends ActionType = ActionType, TOutput = unknown> = {
  name: string
  description?: string
  run: ActionHandler<TType, TOutput>
}

export type TaskDefinition = {
  id: string
  name: string
  steps: AutomationStep[]
  description?: string
}

export type TaskRunOptions = {
  initialInput?: unknown
  context?: ActionContext
  signal?: AbortSignal
  onStepStart?: (step: AutomationStep, stepIndex: number) => void
  onStepComplete?: (
    step: AutomationStep,
    result: ActionExecutionResult,
    stepIndex: number
  ) => void
  onError?: (step: AutomationStep, error: Error, stepIndex: number) => void
}

export type TaskRunResult = {
  success: boolean
  output?: unknown
  error?: Error
  steps: Array<{
    step: AutomationStep
    result: ActionExecutionResult
  }>
}
