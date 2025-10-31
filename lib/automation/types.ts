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

export type CollectWeeklySummaryConfig = {
  /** Number of days to look back when collecting daily recaps. Defaults to 7. */
  days?: number
  /** Artifact type that stores the daily recap payloads. */
  artifactType?: string
  /** Maximum number of entries to fetch before filtering by date. */
  maxEntries?: number
}

export type CollectBlogDigestConfig = {
  /** Number of days to include when gathering blog research notes. Defaults to 7. */
  days?: number
  /** Artifact type backing the stored blog artifacts. Defaults to "blog-research-note". */
  artifactType?: string
  /** Upper bound on fetched entries before date filtering. */
  maxEntries?: number
  /** Maximum distinct tags to highlight in the digest metadata. */
  topTagsLimit?: number
}

export type BlogPromptConfig = Omit<StructuredPromptConfig, "template" | "schema" | "variables"> & {
  template?: StructuredPromptConfig["template"]
  schema?: StructuredPromptConfig["schema"]
  variables?: StructuredPromptConfig["variables"]
}

export type StructuredPromptConfig = {
  /** Prompt template that supports {{placeholders}}. */
  template: string
  /** Name/value pairs for static substitutions. */
  variables?: Record<string, string>
  /** Desired output formatting hint. */
  outputFormat?: "text" | "markdown" | "json"
  /** Optional structured response schema passed to the Prompt API. */
  schema?: Record<string, unknown>
  /** Whether to invoke the Chrome Prompt API. Defaults to true when schema is provided. */
  usePromptApi?: boolean
  /** Optional system-level instructions prepended before user input. */
  systemPrompt?: string
  /** Preferred language tag (BCP-47) for the model output. Defaults to English. */
  outputLanguage?: string
  /** When true, returns the rendered template if the Prompt API is unavailable or fails. */
  fallbackToTemplate?: boolean
  /** Attempts to parse the model response as JSON before returning. Defaults to true when a schema is supplied. */
  coerceJsonOutput?: boolean
  /** Automatically opens the viewer tab after stashing the result. Disabled by default. */
  autoOpenViewer?: boolean
}

export type StoreArtifactConfig = {
  /** Logical grouping for the stored artifact. */
  artifactType?: string
  /** Optional metadata persisted alongside the artifact. */
  metadata?: Record<string, unknown>
  /** Optional tags for future filtering. */
  tags?: string[]
  /** Whether to attempt JSON parsing when the input is a string. Defaults to true. */
  parseJson?: boolean
  /** When true, skips persistence if the input is empty or undefined. Defaults to false. */
  skipWhenEmpty?: boolean
}

export type ActionType =
  | "read-page"
  | "structured-prompt"
  | "store-artifact"
  | "collect-weekly-summary"
  | "blog-prompt"
  | "collect-blog-digest"

export interface ActionTypeConfigMap {
  "read-page": ReadPageConfig
  "structured-prompt": StructuredPromptConfig
  "store-artifact": StoreArtifactConfig
  "collect-weekly-summary": CollectWeeklySummaryConfig
  "blog-prompt": BlogPromptConfig
  "collect-blog-digest": CollectBlogDigestConfig
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
