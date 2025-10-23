declare type LanguageModelAvailabilityState =
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available"

interface LanguageModelPromptOptions {
  signal?: AbortSignal
  responseConstraint?: unknown
  omitResponseConstraintInput?: boolean
}

type LanguageModelPromptMessageRole = "system" | "user" | "assistant"

type LanguageModelPromptMessage = {
  role: LanguageModelPromptMessageRole
  content: string
  prefix?: boolean
}

type LanguageModelExpectedInput = {
  type: "text" | "image" | "audio"
  languages?: string[]
}

type LanguageModelExpectedOutput = {
  type: "text"
  languages?: string[]
}

type LanguageModelDownloadMonitor = EventTarget & {
  addEventListener(
    type: "downloadprogress",
    listener: (event: Event & { loaded: number; total?: number }) => void
  ): void
}

type LanguageModelCreateOptions = {
  expectedInputs?: LanguageModelExpectedInput[]
  expectedOutputs?: LanguageModelExpectedOutput[]
  initialPrompts?: LanguageModelPromptMessage[]
  monitor?: (monitor: LanguageModelDownloadMonitor) => void
  temperature?: number
  topK?: number
  signal?: AbortSignal
}

type LanguageModelAvailabilityOptions = Omit<LanguageModelCreateOptions, "initialPrompts" | "monitor">

type LanguageModelSession = {
  prompt(
    input: string | LanguageModelPromptMessage[],
    options?: LanguageModelPromptOptions
  ): Promise<string>
  promptStreaming?(
    input: string | LanguageModelPromptMessage[],
    options?: LanguageModelPromptOptions
  ): AsyncIterable<string>
  append?(messages: LanguageModelPromptMessage[]): Promise<void>
  destroy?(): void
  inputUsage?: number
  inputQuota?: number
}

type LanguageModelNamespace = {
  availability(options?: LanguageModelAvailabilityOptions): Promise<LanguageModelAvailabilityState>
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>
  params?(): Promise<{
    defaultTemperature: number
    maxTemperature: number
    defaultTopK: number
    maxTopK: number
  }>
}

declare const LanguageModel: LanguageModelNamespace | undefined

declare global {
  interface Window {
    ai?: {
      languageModel?: LanguageModelNamespace
    }
  }
}

export {}
