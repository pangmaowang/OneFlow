import { createScopedDebugger } from "./debug"

const debug = createScopedDebugger("chrome/storage")

type StorageArea = chrome.storage.StorageArea

type StorageItems = Record<string, unknown>

type StorageValue<T = unknown> = T | undefined

function assertChromeStorage() {
  if (typeof chrome === "undefined" || !chrome.storage) {
    throw new Error("Chrome storage APIs are unavailable in this context")
  }
}

function getPreferredArea(): StorageArea {
  assertChromeStorage()
  return chrome.storage.local
}

async function withPromise<T>(fn: (resolve: (value: T) => void, reject: (error: Error) => void) => void) {
  return new Promise<T>((resolve, reject) => {
    fn(resolve, reject)
  })
}

export async function storageSet(items: StorageItems, area: StorageArea = getPreferredArea()) {
  await withPromise<void>((resolve, reject) => {
    area.set(items, () => {
      const lastError = chrome.runtime?.lastError
      if (lastError) {
        debug("set-error", { message: lastError.message })
        reject(new Error(lastError.message))
        return
      }
      resolve()
    })
  })
}

export async function storageGet<T = unknown>(key: string, area: StorageArea = getPreferredArea()) {
  const result = await withPromise<StorageItems>((resolve, reject) => {
    area.get(key, (items) => {
      const lastError = chrome.runtime?.lastError
      if (lastError) {
        debug("get-error", { message: lastError.message })
        reject(new Error(lastError.message))
        return
      }
      resolve(items)
    })
  })
  return result[key] as StorageValue<T>
}

export async function storageRemove(key: string, area: StorageArea = getPreferredArea()) {
  await withPromise<void>((resolve, reject) => {
    area.remove(key, () => {
      const lastError = chrome.runtime?.lastError
      if (lastError) {
        debug("remove-error", { message: lastError.message })
        reject(new Error(lastError.message))
        return
      }
      resolve()
    })
  })
}

export { getPreferredArea as getStorageArea }
