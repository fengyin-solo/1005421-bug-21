import { rejudgeRainRows } from './rain-rules'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-patrol:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...fallback, rain: rejudgeRainRows(fallback.rain ?? []) }
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  let merged = fallback
  if (raw) {
    try {
      merged = { ...fallback, ...(JSON.parse(raw) as Record<string, EntryRow[]>) }
    } catch {
      merged = fallback
    }
  }
  // 存量雨量站按现行口径（rain-rules.ts 那一份）重判一遍并写回，
  // 保证落库那份与明细对得上。
  merged = { ...merged, rain: rejudgeRainRows(merged.rain ?? []) }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  return merged
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
