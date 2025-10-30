export function isAutomationDebugEnabled() {
  return false
}

export function createScopedDebugger(_scope: string) {
  return (_stage: string, _details: Record<string, unknown> = {}) => {
    // intentionally blank
  }
}

export function appendDebugTrace(
  _trace: string[] | undefined,
  _stage: string,
  _details: Record<string, unknown> = {}
) {
  // intentionally blank
}

export function createDebugTrace() {
  return undefined
}
