// Uploading files to a card or project (FR-CNT-006), shared by the files panel, quick-add and board drops.
import type { DragEvent } from 'react'
import { ApiError } from '../api/client'
import { MAX_FILE_BYTES, uploadFile, type FileScope } from '../api/queries'

export interface Upload {
  key: string
  name: string
  error: string | null
}

/** Whether a drag carries files from the desktop (not a card or text). */
export const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files')

/** Uploads files to a target; `update` gets functional changes to an "uploading" list (rows leave when done). */
export async function uploadAll(scope: FileScope, files: readonly File[], update: (fn: (u: Upload[]) => Upload[]) => void = () => {}) {
  const base = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  update((u) => [...u, ...files.map((f, i) => ({ key: `${base}-${i}`, name: f.name, error: f.size > MAX_FILE_BYTES ? 'Over 25 MB' : null }))])
  let failed = 0
  await Promise.all(
    files.map(async (f, i) => {
      const key = `${base}-${i}`
      if (f.size > MAX_FILE_BYTES) {
        failed++
        return
      }
      try {
        await uploadFile(scope, f)
        update((u) => u.filter((x) => x.key !== key))
      } catch (err) {
        failed++
        const msg = err instanceof ApiError ? err.message : "Couldn't upload"
        update((u) => u.map((x) => (x.key === key ? { ...x, error: msg } : x)))
      }
    }),
  )
  return failed
}

