import { OnboardingHost } from '../onboarding/OnboardingHost'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Outlet, useMatch, useNavigate } from 'react-router'
import { onAnyCardRequest, openQuickAdd } from '../cards/cardBus'
import { PREVIEW_EVENT } from '../files/preview'
import { onGoTo } from '../lib/navigate'
import { shellToast } from '../lib/toastBus'
import { onProjectDialog } from '../projects/dialogBus'
import { useSignedOut } from '../api/session'
import { SignIn } from './SignIn'
import { anyLayerOpen, isTypingTarget } from './focusKeys'
import { FocusContext, useFocusMode } from './focusMode'
import { LockSlots } from './LockSlots'
import { TopAlerts } from './TopAlerts'
import { hasModifier, matches } from '../lib/keybinds'
import { setPopupFocus } from '../lib/popupGate'
import { useLockLayers } from '../lib/lockLayers'
import { useApplyPrefs, usePrefs } from './prefs'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { Topbar } from './Topbar'
import { useBootSteps } from './useBootSteps'

/** Announces focus-mode changes, but not the initial state. */
function useFocusAnnouncement(focused: boolean) {
  const [message, setMessage] = useState('')
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setMessage(focused ? 'Focus mode on: Critical and High only' : 'Focus mode off')
  }, [focused])
  return message
}

// The floating sheet (FR-UI-001): inset over the wallpaper, frosted bars, solid content. It sits behind the static
// lock screen while booting and rises into place when the lock opens (lock.css, html[data-lock]).
export function Shell() {
  // F5: no session (at boot, or after Sign out) shows the sign-in screen, never a shell of failing columns.
  return useSignedOut() ? <SignIn /> : <SignedInShell />
}

function SignedInShell() {
  useBootSteps()
  useApplyPrefs()
  const focused = useFocusMode()
  useEffect(() => setPopupFocus(focused), [focused])
  useLockLayers()
  const announcement = useFocusAnnouncement(focused)
  const { sidebar_collapsed } = usePrefs()
  const navigate = useNavigate()
  useEffect(() => onGoTo((path) => void navigate(path)), [navigate])

  return (
    <FocusContext.Provider value={focused}>
      <div className="sheet" data-focus={focused || undefined} data-collapsed={sidebar_collapsed || undefined}>
        <Sidebar />
        <Topbar />
        <main className="sheet-content">
          <Outlet />
        </main>
        <TabBar />
      </div>
      <LockSlots />
      <ProjectDialogSlot />
      <CardsSlot />
      <PreviewSlot />
      <TopAlerts />
      <OnboardingHost />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </FocusContext.Provider>
  )
}

// The project dialog (FR-UI-016) is its own chunk, fetched on the first "New project" or "Edit" (NFR-PERF-010).
const ProjectDialogHost = lazy(() => import('../projects/ProjectDialog').then((m) => ({ default: m.ProjectDialogHost })))

function ProjectDialogSlot() {
  const [wanted, setWanted] = useState(false)
  useEffect(() => onProjectDialog(() => setWanted(true)), [])
  return wanted ? (
    <Suspense fallback={null}>
      <ProjectDialogHost onToast={(m) => shellToast(m)} />
    </Suspense>
  ) : null
}

// Quick-add and the card sheet (FR-CNT-001/002): their own chunk, fetched on the first + / n / paste / card click.
const CardsHost = lazy(() => import('../cards/CardsHost').then((m) => ({ default: m.CardsHost })))

function CardsSlot() {
  const [wanted, setWanted] = useState(false)
  const project = useMatch('/projects/:id')?.params.id
  useEffect(() => onAnyCardRequest(() => setWanted(true)), [])
  useEffect(() => {
    // n (or the Settings key): quick-add (decisions item 11), never while typing or with a dialog open.
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !matches(e, 'quick_add') || (!hasModifier('quick_add') && (isTypingTarget(e.target) || anyLayerOpen()))) return
      e.preventDefault()
      openQuickAdd({ projectId: project })
    }
    // FR-UI-030: pasting text or a file outside a field creates a card.
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || anyLayerOpen() || !e.clipboardData) return
      const files = [...e.clipboardData.files]
      const text = e.clipboardData.getData('text/plain').trim().split('\n')[0]?.slice(0, 300) ?? ''
      if (!files.length && !text) return
      e.preventDefault()
      openQuickAdd({ text: text || files[0]?.name || '', projectId: project, files: files.length ? files : undefined })
    }
    addEventListener('keydown', onKey)
    addEventListener('paste', onPaste)
    return () => {
      removeEventListener('keydown', onKey)
      removeEventListener('paste', onPaste)
    }
  }, [project])
  return wanted ? (
    <Suspense fallback={null}>
      <CardsHost />
    </Suspense>
  ) : null
}

// The file preview (FR-CNT-008): its own chunk, fetched on the first Preview.
const FilePreviewHost = lazy(() => import('../files/FilePreview').then((m) => ({ default: m.FilePreviewHost })))

function PreviewSlot() {
  const [wanted, setWanted] = useState(false)
  useEffect(() => {
    const on = () => setWanted(true)
    addEventListener(PREVIEW_EVENT, on)
    return () => removeEventListener(PREVIEW_EVENT, on)
  }, [])
  return wanted ? (
    <Suspense fallback={null}>
      <FilePreviewHost />
    </Suspense>
  ) : null
}
