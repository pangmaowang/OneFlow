import { openDB, type DBSchema, type IDBPDatabase } from "idb"

import { createScopedDebugger } from "../debug"

export type ArtifactCategory = "development-task" | "prompt-result" | string

export type StoredArtifactPayload = {
  raw: string
  parsed?: unknown
}

export type StoredArtifactRecord = {
  id: string
  type: ArtifactCategory
  payload: StoredArtifactPayload
  createdAt: number
  metadata?: Record<string, unknown>
  tags?: string[]
}

export type CreateArtifactInput = {
  type: ArtifactCategory
  payload: StoredArtifactPayload
  metadata?: Record<string, unknown>
  tags?: string[]
  id?: string
  createdAt?: number
}

export type ListArtifactsQuery = {
  type?: ArtifactCategory
  limit?: number
  order?: "asc" | "desc"
}

interface AutomationDatabase extends DBSchema {
  artifacts: {
    key: string
    value: StoredArtifactRecord
    indexes: {
      "by-type": ArtifactCategory
      "by-createdAt": number
    }
  }
}

const DB_NAME = "auto-boring-automation"
const DB_VERSION = 1
const STORE_NAME = "artifacts" as const
const CREATED_AT_INDEX = "by-createdAt"
const TYPE_INDEX = "by-type"

const debug = createScopedDebugger("storage/artifacts")

let dbPromise: Promise<IDBPDatabase<AutomationDatabase>> | null = null
let useMemoryFallback = false
const memoryStore = new Map<string, StoredArtifactRecord>()

function indexedDbAvailable() {
  return typeof indexedDB !== "undefined"
}

async function getDatabase() {
  if (useMemoryFallback || !indexedDbAvailable()) {
    return null
  }

  if (!dbPromise) {
    dbPromise = openDB<AutomationDatabase>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" })
          store.createIndex(TYPE_INDEX, "type")
          store.createIndex(CREATED_AT_INDEX, "createdAt")
        }
      }
    }).catch((error) => {
      dbPromise = null
      useMemoryFallback = true
      debug("open-error", { message: (error as Error).message })
      return null
    })
  }

  try {
    return await dbPromise
  } catch (error) {
    useMemoryFallback = true
    debug("init-error", { message: (error as Error).message })
    return null
  }
}

function ensureRecordId(providedId?: string) {
  if (providedId && providedId.trim().length > 0) {
    return providedId
  }

  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  const random = Math.random().toString(36).slice(2)
  return `artifact-${Date.now()}-${random}`
}

function persistInMemory(record: StoredArtifactRecord) {
  memoryStore.set(record.id, record)
  return record
}

function removeFromMemory(id: string) {
  memoryStore.delete(id)
}

function listFromMemory(query: ListArtifactsQuery = {}) {
  const { type, limit, order = "desc" } = query
  const records = Array.from(memoryStore.values())
    .filter((record) => (type ? record.type === type : true))
    .sort((a, b) => (order === "asc" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt))

  return limit ? records.slice(0, limit) : records
}

export async function saveArtifact(input: CreateArtifactInput) {
  const createdAt = input.createdAt ?? Date.now()
  const record: StoredArtifactRecord = {
    id: ensureRecordId(input.id),
    type: input.type,
    payload: input.payload,
    createdAt,
    metadata: input.metadata,
    tags: input.tags?.length ? [...input.tags] : undefined
  }

  const db = await getDatabase()
  if (!db) {
    return persistInMemory(record)
  }

  await db.put(STORE_NAME, record)
  return record
}

export async function getArtifact(id: string) {
  const db = await getDatabase()
  if (!db) {
    return memoryStore.get(id)
  }

  return db.get(STORE_NAME, id)
}

export async function listArtifacts(query: ListArtifactsQuery = {}) {
  const db = await getDatabase()
  if (!db) {
    return listFromMemory(query)
  }

  const { type, limit, order = "desc" } = query
  const results: StoredArtifactRecord[] = []
  const direction = order === "asc" ? "next" : "prev"

  const transaction = db.transaction(STORE_NAME, "readonly")
  const store = transaction.store
  const index = store.index(CREATED_AT_INDEX)

  for (let cursor = await index.openCursor(null, direction); cursor; cursor = await cursor.continue()) {
    const value = cursor.value
    if (type && value.type !== type) {
      continue
    }

    results.push(value)

    if (limit && results.length >= limit) {
      break
    }
  }

  await transaction.done
  return results
}

export async function deleteArtifact(id: string) {
  const db = await getDatabase()
  if (!db) {
    removeFromMemory(id)
    return
  }

  await db.delete(STORE_NAME, id)
}

export async function clearArtifacts() {
  const db = await getDatabase()
  if (!db) {
    memoryStore.clear()
    return
  }

  await db.clear(STORE_NAME)
}