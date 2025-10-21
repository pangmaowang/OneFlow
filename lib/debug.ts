const envFlag =
  typeof process !== "undefined" ? process.env.PLASMO_PUBLIC_AUTOMATION_DEBUG : undefined

function readRuntimeFlag() {
  if (
    typeof globalThis !== "undefined" &&
    Object.prototype.hasOwnProperty.call(globalThis, "__AUTO_BORING_DEBUG__")
  ) {
    return Boolean((globalThis as { __AUTO_BORING_DEBUG__?: unknown }).__AUTO_BORING_DEBUG__)
  }

  return undefined
}

export function isAutomationDebugEnabled() {
  if (envFlag === "true") {
    return true
  }

  if (envFlag === "false") {
    return false
  }

  return readRuntimeFlag() === true
}

export function createScopedDebugger(scope: string) {
  return (stage: string, details: Record<string, unknown> = {}) => {
    if (!isAutomationDebugEnabled()) {
      return
    }

    // eslint-disable-next-line no-console
    console.info(`[${scope}] ${stage}`, details)
  }
}

export function appendDebugTrace(
  trace: string[] | undefined,
  stage: string,
  details: Record<string, unknown> = {}
) {
  if (!trace) {
    return
  }

  trace.push(`${stage}: ${JSON.stringify(details)}`)
}

export function createDebugTrace() {
  return isAutomationDebugEnabled() ? [] : undefined
}
