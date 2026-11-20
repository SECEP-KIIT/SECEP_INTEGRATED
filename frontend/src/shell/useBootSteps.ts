import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { DEFAULT_COLUMN_QUERY, emailListOptions, layoutOptions, queryClient, useMe } from '../api/queries'
import { currentDevice } from '../lib/breakpoints'
import { connectRealtime } from '../api/realtime'
import { lock } from '../boot/lock'

/**
 * Reports real boot steps to the lock screen's progress ring (FR-WP-003). A step counts once its request has
 * settled, success or error, so a failed request can't leave the lock stuck; the app shows the error itself.
 */
export function useBootSteps() {
  const me = useMe()
  // /emails is a boot step on every route, so fetch it here; the default inbox column reuses the same cache entry.
  const emails = useInfiniteQuery(emailListOptions(DEFAULT_COLUMN_QUERY))

  useEffect(() => {
    // The shell renders only after the router has loaded the matched route chunks: the app JS is in.
    lock.step('app')
    // The dashboard layout for this device class (FR-UI-010), so / opens with its pages ready.
    void queryClient.fetchQuery(layoutOptions(currentDevice())).finally(() => lock.step('layout'))
    // The socket connects once for the app's lifetime (idempotent, so StrictMode's double effect is harmless).
    connectRealtime(queryClient, () => lock.step('socket'))
  }, [])

  useEffect(() => {
    if (!me.isPending) lock.step('me')
  }, [me.isPending])

  useEffect(() => {
    if (!emails.isPending) lock.step('emails')
  }, [emails.isPending])
}
