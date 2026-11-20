import { Checklist } from '../onboarding/Checklist'
import { ArrowLeft, ArrowRight, Check, LayoutGrid, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { useSearchParams } from 'react-router'
import type { Widget } from '../api/types'
import { FlowPage } from '../dashboard/FlowPage'
import { Gallery } from '../dashboard/Gallery'
import { isPhoneLayout } from '../dashboard/grid'
import {
  addHandledPage,
  addPage,
  addWidget,
  handledPage,
  duplicateWidget,
  MAX_PAGES,
  movePage,
  patchWidget,
  removePage,
  removeWidget,
  renamePage,
  resizeWidget,
  restorePage,
  slots,
  stackTargetBefore,
  stackWidget,
  unstackWidget,
  sortedPages,
  updatePage,
} from '../dashboard/layoutModel'
import { isSideways, pageKeyAction, SWIPE_TOUCH_PX, SWIPE_WHEEL_PX } from '../dashboard/pageKeys'
import { PhoneEditSheet } from '../dashboard/PhoneEditSheet'
import { PhonePage } from '../dashboard/PhonePage'
import { useLayout, type SaveState } from '../dashboard/useLayout'
import { WidgetFrame, type WidgetActions } from '../dashboard/WidgetFrame'
import { useInbox } from '../inbox/inboxContext'
import { goTo } from '../lib/navigate'
import { anyLayerOpen } from '../shell/focusKeys'
import { InboxHost } from '../inbox/InboxHost'
import { useDeviceClass } from '../shell/useDeviceClass'
import '../dashboard/dashboard.css'

const SWIPE_COOLDOWN_MS = 600

/**
 * The paged dashboard at `/` (FR-UI-006–010, item 2). Pages of widget tiles, saved per user and device class.
 * Desktop and tablet flow tiles into rows of 3 slots (proposals §16.3); phones stack them. Only the active page renders.
 */
export function Component() {
  return (
    <InboxHost>
      <Dashboard />
    </InboxHost>
  )
}

function Dashboard() {
  const device = useDeviceClass()
  const phone = isPhoneLayout(device)
  const { toast } = useInbox()
  const { pages, isDefault, query, state, update } = useLayout(device, toast)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [direction, setDirection] = useState<-1 | 1>(1)
  const [editingState, setEditing] = useState(false)
  const [gallery, setGallery] = useState(false)
  // Phones edit in a sheet (PhoneEditSheet), not in place.
  const editing = editingState && !phone
  const [sheet, setSheet] = useState(false)

  const sorted = pages ? sortedPages(pages) : []
  const index = Math.max(0, sorted.findIndex((p) => p.id === activeId))
  const page = sorted[index]

  // `/?page=handled` (QA pass 5, "See" on a Mark-handled toast): go to the Handled page, adding it to a layout saved
  // before it was a starter page; at the page cap, the Handled full view instead.
  const [params, setParams] = useSearchParams()
  const wanted = params.get('page')
  useEffect(() => {
    if (wanted !== 'handled' || !pages) return
    setParams((p) => (p.delete('page'), p), { replace: true })
    const found = handledPage(pages)
    // oxlint-disable-next-line react/set-state-in-effect -- follows the URL (an external system) once, then clears it
    if (found) return setActiveId(found.id)
    const next = addHandledPage(pages)
    if (!next) return void goTo('/inbox?view=handled')
    update(() => next)
    setActiveId(sortedPages(next).at(-1)!.id)
  }, [wanted, pages, setParams, update])

  const go = (i: number) => {
    const target = sorted[Math.min(Math.max(i, 0), sorted.length - 1)]
    if (!target || target.id === page?.id) return
    setDirection(i > index ? 1 : -1)
    setActiveId(target.id)
  }
  const goRef = useRef(go)
  useEffect(() => {
    goRef.current = go
  })

  // Ctrl+←/→, Ctrl+1…9 (FR-UI-007).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const action = pageKeyAction(e, sorted.length, anyLayerOpen())
      if (!action) return
      e.preventDefault()
      goRef.current('to' in action ? action.to : index + action.by)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [sorted.length, index])

  // Trackpad swipe (wheel deltaX) and touch swipe. Never while editing, where dragging means moving tiles.
  // A native, non-passive listener, so a sideways swipe is claimed (preventDefault) and never reaches the browser as
  // history navigation. overscroll-behavior-x: none on html, body and the pages does the same in CSS.
  const pagesRef = useRef<HTMLDivElement>(null)
  const wheel = useRef({ dx: 0, until: 0, editing, index })
  useEffect(() => {
    wheel.current.editing = editing
    wheel.current.index = index
  })
  const ready = !query.isPending && !!page
  useEffect(() => {
    const el = pagesRef.current
    if (!el) return
    const onWheel = (e: globalThis.WheelEvent) => {
      const w = wheel.current
      if (w.editing || !isSideways(e.deltaX, e.deltaY)) return
      e.preventDefault()
      const now = Date.now()
      if (now < w.until) return
      w.dx += e.deltaX
      if (Math.abs(w.dx) >= SWIPE_WHEEL_PX) {
        goRef.current(w.index + (w.dx > 0 ? 1 : -1))
        w.dx = 0
        w.until = now + SWIPE_COOLDOWN_MS
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ready])
  const touch = useRef<{ x: number; y: number } | null>(null)
  // Phones switch pages with the segmented control only: no horizontal swipe there (proposals §16.4).
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' && !editing && !phone) touch.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e: PointerEvent) => {
    const start = touch.current
    touch.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) >= SWIPE_TOUCH_PX && isSideways(dx, dy)) go(index + (dx < 0 ? 1 : -1))
  }

  if (query.isPending) return <div className="dash dash-loading" aria-busy="true" />
  if (query.isError || !page) {
    return (
      <div className="dash col-state" role="alert">
        <p>Couldn't load your dashboard.</p>
        <button type="button" className="text-button" onClick={() => void query.refetch()}>
          Try again
        </button>
      </div>
    )
  }

  const editPage = (fn: Parameters<typeof updatePage>[2]) => update((ps) => updatePage(ps, page.id, fn))
  const actionsFor = (w: Widget): WidgetActions => ({
    patch: (patch) => editPage((p) => patchWidget(p, w.id, patch)),
    resize: (size) => editPage((p) => resizeWidget(p, w.id, size)),
    stack: (() => {
      const target = stackTargetBefore(page, w.id)
      return target ? () => editPage((p) => stackWidget(p, w.id, target)) : undefined
    })(),
    unstack: slots(page.widgets).some((s) => s.length === 2 && s.some((x) => x.id === w.id)) ? () => editPage((p) => unstackWidget(p, w.id)) : undefined,
    duplicate: () => {
      const next = duplicateWidget(page, w.id)
      if (next) editPage(() => next)
      return next !== null
    },
    remove: () => editPage((p) => removeWidget(p, w.id)),
  })
  const render = (id: string) => {
    const w = page.widgets.find((x) => x.id === id)
    return w && <WidgetFrame widget={w} device={device} editing={editing} actions={actionsFor(w)} />
  }

  const newPage = () => {
    const next = addPage(sorted)
    if (!next) return toast(`A dashboard holds up to ${MAX_PAGES} pages.`)
    update(() => next)
    setDirection(1)
    setActiveId(sortedPages(next).at(-1)!.id)
  }

  // Moving a page keeps you on it, and its dot moves with it (QA pass 3).
  const shiftPage = (by: -1 | 1) => {
    setActiveId(page.id)
    update((ps) => movePage(ps, page.id, by))
  }

  // Deleting a page can be undone for 10 s (the FR-UI-029 pattern). The page after it (or before, if it was last)
  // takes its place on screen.
  const deletePage = () => {
    const removed = page
    setSheet(false)
    setActiveId((sorted[index + 1] ?? sorted[index - 1])?.id ?? null)
    update((ps) => removePage(ps, removed.id))
    toast(`Deleted page “${removed.name}”.`, 'info', {
      label: 'Undo',
      run: () => {
        update((ps) => restorePage(ps, removed))
        setActiveId(removed.id)
      },
    })
  }

  return (
    <div className="dash" data-editing={editing || undefined}>
      <Checklist />
      {phone ? (
        // Phone: one slim header row, the page switcher and Edit (proposals §16.4).
        <div className="dash-bar phone-bar">
          <PageSwitch pages={sorted} index={index} onGo={go} onAdd={newPage} />
          <button type="button" className="ghost-button" onClick={() => setSheet(true)}>
            <LayoutGrid size={14} aria-hidden="true" /> Edit
          </button>
        </div>
      ) : (
      <div className="dash-bar">
        {editing ? (
          <div className="dash-page-tools">
            <label className="sr-only" htmlFor="page-name">
              Page name
            </label>
            <input
              id="page-name"
              className="dash-page-name"
              defaultValue={page.name}
              key={page.id}
              maxLength={40}
              onBlur={(e) => update((ps) => renamePage(ps, page.id, e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <button type="button" className="col-tool" title="Move page left" disabled={index === 0} onClick={() => shiftPage(-1)}>
              <ArrowLeft size={15} aria-hidden="true" />
              <span className="sr-only">Move page left</span>
            </button>
            <button type="button" className="col-tool" title="Move page right" disabled={index === sorted.length - 1} onClick={() => shiftPage(1)}>
              <ArrowRight size={15} aria-hidden="true" />
              <span className="sr-only">Move page right</span>
            </button>
            <button type="button" className="col-tool" title="Delete this page" disabled={sorted.length <= 1} onClick={deletePage}>
              <Trash2 size={15} aria-hidden="true" />
              <span className="sr-only">Delete this page</span>
            </button>
          </div>
        ) : (
          <h2 className="dash-title">{page.name}</h2>
        )}
        <SaveStatus state={state} isDefault={isDefault} />
        {(editing || page.widgets.length === 0) && (
          <button type="button" className="ghost-button" onClick={() => setGallery(true)}>
            <Plus size={14} aria-hidden="true" /> Add widget
          </button>
        )}
        {!phone && (
          <button type="button" className={editing ? 'primary-button' : 'ghost-button'} aria-pressed={editing} onClick={() => setEditing(!editing)}>
            {editing ? <Check size={14} aria-hidden="true" /> : <LayoutGrid size={14} aria-hidden="true" />}
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>
      )}

      <div className="dash-pages" ref={pagesRef} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <div key={page.id} className="dash-page" data-direction={direction}>
          {page.widgets.length === 0 ? (
            // An empty page offers Add widget straight away, until its first widget is added (19 Nov 2026).
            <div className="col-state">
              <p className="col-state-title">An empty page</p>
              <div className="dash-empty-actions">
                <button type="button" className="primary-button" onClick={() => setGallery(true)}>
                  <Plus size={14} aria-hidden="true" /> Add widget
                </button>
                {sorted.length > 1 && (
                  <button type="button" className="ghost-button" onClick={deletePage}>
                    <Trash2 size={14} aria-hidden="true" /> Delete page
                  </button>
                )}
              </div>
            </div>
          ) : phone ? (
            <PhonePage page={page} render={render} />
          ) : (
            <FlowPage page={page} editing={editing} render={render} onChange={(next) => editPage(() => next)} />
          )}
        </div>
      </div>

      {!phone && (
      <nav className="page-dots" aria-label="Pages">
        {/* Hover or focus shows every page name, side by side in page order, above the dots (QA pass 3: pills
            placed over their own dots overlapped). Pointer users can click a name; the dots are the keyboard route. */}
        <div className="page-pills" aria-hidden="true">
          {sorted.map((p, i) => (
            <button key={p.id} type="button" tabIndex={-1} className="dot-pill" data-current={i === index || undefined} onClick={() => go(i)}>
              {p.name}
            </button>
          ))}
        </div>
        {sorted.map((p, i) => (
          <button key={p.id} type="button" className="page-dot" aria-current={i === index ? 'page' : undefined} onClick={() => go(i)} title={`${p.name} (Ctrl+${i + 1})`}>
            <span className="dot" aria-hidden="true" />
            <span className="sr-only">{p.name}</span>
          </button>
        ))}
        <button type="button" className="page-dot page-add" onClick={newPage} title="Add a page" disabled={sorted.length >= MAX_PAGES}>
          <Plus size={12} aria-hidden="true" />
          <span className="sr-only">Add a page</span>
        </button>
      </nav>
      )}

      {phone && sheet && (
        <PhoneEditSheet
          page={page}
          canDelete={sorted.length > 1}
          status={saveText(state, isDefault)}
          onChange={(next) => editPage(() => next)}
          onRename={(name) => update((ps) => renamePage(ps, page.id, name))}
          onAdd={() => setGallery(true)}
          onDelete={deletePage}
          onClose={() => setSheet(false)}
        />
      )}

      <Gallery
        open={gallery}
        onClose={() => setGallery(false)}
        onPick={(preset) => {
          const next = addWidget(page, preset)
          if (!next) return toast('This page is full. Add a page first.')
          editPage(() => next)
          setGallery(false)
        }}
      />
    </div>
  )
}

const saveText = (state: SaveState, isDefault: boolean) =>
  isDefault && state === 'saved' ? 'Starter layout' : { saved: 'Saved', pending: 'Saving…', saving: 'Saving…', error: 'Not saved' }[state]

function SaveStatus({ state, isDefault }: { state: SaveState; isDefault: boolean }) {
  return (
    <span className="dash-save" data-state={state} role="status">
      {saveText(state, isDefault)}
    </span>
  )
}

/**
 * The phone's page switcher (proposals §16.4): a segmented control, Today | Triage | Planning | +, replacing the
 * dots and swipe. The current page is pressed (filled, plus weight; not colour alone). It scrolls sideways when the
 * names don't fit, keeping the current one in view.
 */
function PageSwitch({ pages, index, onGo, onAdd }: { pages: { id: string; name: string }[]; index: number; onGo: (i: number) => void; onAdd: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [index])
  return (
    <div className="page-switch" role="group" aria-label="Pages" ref={ref}>
      {pages.map((p, i) => (
        <button key={p.id} type="button" className="page-seg" aria-pressed={i === index} onClick={() => onGo(i)}>
          {p.name}
        </button>
      ))}
      <button type="button" className="page-seg page-seg-add" onClick={onAdd} disabled={pages.length >= MAX_PAGES} title="Add a page">
        <Plus size={14} aria-hidden="true" />
        <span className="sr-only">Add a page</span>
      </button>
    </div>
  )
}
