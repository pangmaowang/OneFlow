import type { PlasmoCSConfig } from "plasmo"

import {
  READ_PAGE_MESSAGE,
  extractDocumentContent,
  type ReadPageRequest,
  type ReadPageResponse
} from "@/lib/automation/extraction"
import { createScopedDebugger } from "@/lib/debug"

export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*"],
  run_at: "document_idle"
}

const debug = createScopedDebugger("auto-boring/content")

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== READ_PAGE_MESSAGE) {
    return
  }

  const request = message as ReadPageRequest
  debug("read-page request", {
    selector: request.selector,
    attribute: request.attribute
  })

  try {
    const payload = extractDocumentContent(document, {
      selector: request.selector,
      attribute: request.attribute
    })

    const response: ReadPageResponse = {
      success: true,
      payload
    }

    debug("read-page success", {
      length: payload.body.length,
      selectionLength: payload.selectionLength
    })

    sendResponse(response)
  } catch (error) {
    const response: ReadPageResponse = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }

    // eslint-disable-next-line no-console
    console.warn("[auto-boring/content] read-page failure", {
      message: response.error
    })

    sendResponse(response)
  }

  return true
})

export {}
