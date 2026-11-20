import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { layoutOptions, putLayout, queryClient } from '../api/queries'
import type { LayoutDeviceClass, LayoutPage } from '../api/types'

/** Saves this long after the last change (FR-UI-010), so a drag or a typed title is one PUT, not many. */
export const SAVE_DEBOUNCE_MS = 800

export type SaveState = 'saved' | 'pending' | 'saving' | 'error'

/**
 * The user's layout for one device class: the server copy plus a local draft while edits wait to be saved.
 *
 * Saving is a full replace (PUT) carrying `base_updated_at`, the version the edits started from. One save is in
 * flight at a time; edits made meanwhile go out in the next. A 409 means another window or device saved first:
 * the local draft is dropped and the latest layout reloaded, so two windows never silently overwrite each other.
 */
export function useLayout(device: LayoutDeviceClass, notify: (message: string, tone?: 'info' | 'error') => void) {
  const query = useQuery(layoutOptions(device))
  const [draft, setDraft] = useState<{ device: LayoutDeviceClass; pages: LayoutPage[] } | null>(null)
  const [state, setState] = useState<SaveState>('saved')
  const pending = useRef<{ device: LayoutDeviceClass; pages: LayoutPage[] } | null>(null)
  const inFlight = useRef(false)
  const timer = useRef(0)
  const notifyRef = useRef(notify)
  useEffect(() => {
    notifyRef.current = notify
  }, [notify])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    if (inFlight.current) return
    inFlight.current = true
    // One save at a time; edits made while a save is in flight go out right after it.
    while (pending.current) {
      const job = pending.current
      pending.current = null
      setState('saving')
      const key = layoutOptions(job.device).queryKey
      try {
        const base = queryClient.getQueryData(key)?.updated_at ?? null
        const saved = await putLayout(job.device, { pages: job.pages, base_updated_at: base })
        queryClient.setQueryData(key, saved)
        // Nothing newer waiting: the server copy is now the truth.
        if (!pending.current) {
          setDraft((d) => (d?.pages === job.pages ? null : d))
          setState('saved')
        }
      } catch (err) {
        if (err instanceof ApiError && err.code === 'conflict') {
          pending.current = null
          setDraft(null)
          setState('saved')
          notifyRef.current('This layout was changed in another window. Showing the latest version.')
          await queryClient.refetchQueries({ queryKey: key, exact: true })
        } else {
          // Keep the draft on screen; it goes out again with the next change (no retry loop here).
          pending.current ??= job
          setState('error')
          notifyRef.current("Couldn't save the layout. It will retry with your next change.", 'error')
          break
        }
      }
    }
    inFlight.current = false
  }, [])

  const pages = (draft?.device === device ? draft.pages : null) ?? query.data?.pages ?? null

  const update = useCallback(
    (fn: (pages: LayoutPage[]) => LayoutPage[] | null) => {
      setDraft((d) => {
        const current = (d?.device === device ? d.pages : null) ?? queryClient.getQueryData(layoutOptions(device).queryKey)?.pages
        if (!current) return d
        const next = fn(current)
        if (!next || next === current) return d
        pending.current = { device, pages: next }
        return { device, pages: next }
      })
      setState('pending')
      clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
    },
    [device, flush],
  )

  // Leaving the dashboard, or crossing a breakpoint: save what's waiting now rather than drop it.
  useEffect(() => () => void flush(), [device, flush])

  return { pages, isDefault: draft === null && (query.data?.is_default ?? false), query, state, update }
}
