import * as Popover from '@radix-ui/react-popover'
import { Board } from '../board/Board'
import { Copy, Ellipsis, Layers, Maximize2, Pencil, SquareSplitVertical, Trash2 } from 'lucide-react'
import { lazy, Suspense, useContext, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { LayoutDeviceClass, Widget, WidgetSize } from '../api/types'
import { filterQuery, parseColumnQuery, QUICK_VIEWS, sortKeyOf, toggleFilter, type ColumnState } from '../inbox/cardModel'
import { Column } from '../inbox/Column'
import { PortalContainer } from '../inbox/portal'
import { useDragHandle } from './dragHandle'
import { PhoneSection } from './PhoneSection'
import { SIZES } from './grid'
import { BUILT_TYPES, fullViewHref, ICONS, SWATCHES, widgetTitle } from './layoutModel'

// Standalone notes (FR-CNT-003): their own chunk, loaded when a Notes widget is on the page.
const NotesPanel = lazy(() => import('../notes/NotesPanel').then((m) => ({ default: m.NotesPanel })))
const StatsWidget = lazy(() => import('../stats/StatsWidget').then((m) => ({ default: m.StatsWidget })))

const LONG_PRESS_MS = 500

export interface WidgetActions {
  patch: (patch: Partial<Omit<Widget, 'id' | 'type'>>) => void
  resize: (size: WidgetSize) => void
  duplicate: () => boolean
  remove: () => void
  /** Desktop and tablet (F18): share the slot of the tile before, or leave a pair. Undefined when not possible. */
  stack?: () => void
  unstack?: () => void
}

/**
 * One tile (FR-UI-006/008, item 2): a title bar with the widget's emoji, name and colour (a tinted bar plus a thin
 * left stripe), ⤢ to the full view, and the title-bar menu on ⋯, right-click or long-press: Rename (also a
 * double-click on the title), Colour, Icon, Size, Duplicate, Remove. Only inbox columns are built; any other saved
 * type shows a placeholder until its task lands.
 */
export function WidgetFrame({ widget, device, editing, actions }: { widget: Widget; device: LayoutDeviceClass; editing: boolean; actions: WidgetActions }) {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const title = widgetTitle(widget)
  const stack = device === 'phone'
  // While editing on desktop and tablet, the title bar is the drag handle (FlowPage).
  const handle = useDragHandle()
  const drag = editing ? handle : null

  // Long-press on the title bar opens the menu on touch (FR-UI-008).
  const press = useRef(0)
  const onPointerDown = (e: PointerEvent) => {
    drag?.listeners?.onPointerDown?.(e)
    if (e.pointerType === 'mouse') return
    press.current = window.setTimeout(() => setMenu(true), LONG_PRESS_MS)
  }
  const cancelPress = () => clearTimeout(press.current)
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    setMenu(true)
  }

  const heading = (titleId: string) => (
    <div
      className="widget-bar"
      ref={drag?.ref}
      {...drag?.attributes}
      {...drag?.listeners}
      // Pressing to drag isn't a long-press for the menu: moving cancels it, like a scroll.
      onPointerMove={(e) => e.buttons && cancelPress()}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      aria-label={drag ? `Move ${title}` : undefined}
    >
      {widget.icon && (
        <span className="widget-icon" aria-hidden="true">
          {widget.icon}
        </span>
      )}
      {renaming ? (
        <RenameField
          initial={title}
          onDone={(name) => {
            setRenaming(false)
            if (name !== null && name !== title) actions.patch({ title: name })
          }}
        />
      ) : (
        <h2 className="col-title widget-title" id={titleId} tabIndex={-1} onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
          {title}
        </h2>
      )}
    </div>
  )

  const tools = (
    <span className="widget-tools">
      {(widget.type === 'inbox_column' || widget.type === 'board') && !stack && (
        <Link className="col-tool" to={widget.type === 'board' ? '/board' : fullViewHref(widget)} title="Open as full view">
          <Maximize2 size={15} aria-hidden="true" />
          <span className="sr-only">Open {title} as full view</span>
        </Link>
      )}
      <WidgetMenu
        widget={widget}
        device={device}
        onClose={() => setMenu(false)}
        onRename={() => {
          setMenu(false)
          setRenaming(true)
        }}
        actions={actions}
      />
    </span>
  )

  // F16: the menu opens beside the tile (anchored to it), never over its column.
  return (
    <Popover.Root open={menu} onOpenChange={setMenu}>
    <Popover.Anchor asChild>
    <div className="widget" data-swatch={widget.colour ?? undefined} data-editing={editing || undefined}>
      {widget.type === 'inbox_column' && stack ? (
        <PhoneSection widget={widget} heading={heading} tools={tools} />
      ) : widget.type === 'inbox_column' ? (
        <ColumnWidget widget={widget} title={title} heading={heading} tools={tools} onChange={actions.patch} locked={editing} />
      ) : widget.type === 'board' ? (
        <section className="column board-widget" aria-labelledby={`w-${widget.id}`}>
          <header className="col-head">
            <div className="col-title-row">
              {heading(`w-${widget.id}`)}
              {tools}
            </div>
          </header>
          <div className="col-body" ref={(n) => n && (n.inert = editing)}>
            <Board variant="tile" label={title} />
          </div>
        </section>
      ) : widget.type === 'notes' ? (
        <section className="column notes-widget" aria-labelledby={`w-${widget.id}`}>
          <header className="col-head">
            <div className="col-title-row">
              {heading(`w-${widget.id}`)}
              {tools}
            </div>
          </header>
          <div className="col-body" ref={(n) => n && (n.inert = editing)}>
            <Suspense fallback={<p className="col-state">Loading notes…</p>}>
              <NotesPanel scope={null} />
            </Suspense>
          </div>
        </section>
      ) : widget.type === 'stats' ? (
        <section className="column stats-widget" aria-labelledby={`w-${widget.id}`}>
          <header className="col-head">
            <div className="col-title-row">
              {heading(`w-${widget.id}`)}
              {tools}
            </div>
          </header>
          <div className="col-body" ref={(n) => n && (n.inert = editing)}>
            <Suspense fallback={<p className="col-state">Loading stats…</p>}>
              <StatsWidget />
            </Suspense>
          </div>
        </section>
      ) : (
        <section className="column widget-placeholder" aria-label={title}>
          <header className="col-head">
            <div className="col-title-row">
              {heading(`w-${widget.id}`)}
              {tools}
            </div>
          </header>
          <p className="col-state">{BUILT_TYPES.includes(widget.type) ? '' : `${title} isn't built yet. It arrives with its own task.`}</p>
        </section>
      )}
    </div>
    </Popover.Anchor>
    </Popover.Root>
  )
}

/** The column's filter, sort and density live in the widget, so every change is saved with the layout. */
function ColumnWidget({ widget, title, heading, tools, onChange, locked }: {
  widget: Widget
  title: string
  heading: (titleId: string) => ReactNode
  tools: ReactNode
  onChange: WidgetActions['patch']
  locked: boolean
}) {
  const state = useMemo<ColumnState>(
    () => ({ filters: parseColumnQuery(widget.filter ?? '').filters, sort: sortKeyOf(widget.sort), density: widget.density ?? 'comfortable' }),
    [widget.filter, widget.sort, widget.density],
  )
  return (
    <Column
      title={title}
      state={state}
      onStateChange={(s) => onChange({ filter: filterQuery(s.filters), sort: s.sort, density: s.density })}
      heading={heading}
      tools={tools}
      variant="tile"
      locked={locked}
    />
  )
}

function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial)
  const finish = (save: boolean) => onDone(save && value.trim() ? value.trim().slice(0, 60) : null)
  return (
    <input
      className="widget-rename"
      aria-label="Widget name"
      value={value}
      maxLength={60}
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- the user just asked to rename; focus belongs here
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true)
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish(false)
        }
      }}
    />
  )
}

// F17: sizes by width only; every tile is the full row height (half when stacked).
const SIZE_LABEL: Record<WidgetSize, string> = { small: '1x', medium: '2x', large: '3x' }
const SIZE_TITLE: Record<WidgetSize, string> = { small: 'One column wide', medium: 'Two columns wide', large: 'Three columns wide' }

function WidgetMenu({ widget, device, onClose, onRename, actions }: {
  widget: Widget
  device: LayoutDeviceClass
  onClose: () => void
  onRename: () => void
  actions: WidgetActions
}) {
  const container = useContext(PortalContainer)
  const [note, setNote] = useState<string | null>(null)
  const swatch = SWATCHES.find((s) => s.key === widget.colour)
  // The quick filters a tile has no room for (F16): toggling one changes this tile's saved filter.
  const filters = widget.type === 'inbox_column' ? parseColumnQuery(widget.filter ?? '').filters : null
  return (
    <>
      <Popover.Trigger asChild>
        <button type="button" className="col-tool" title="Widget menu (or right-click the title)" aria-label={`${widgetTitle(widget)} widget menu`}>
          <Ellipsis size={16} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content className="menu widget-menu" side="right" align="start" sideOffset={8} collisionPadding={12} onCloseAutoFocus={() => setNote(null)}>
          {filters && (
            <fieldset className="menu-group">
              <legend>Quick filters</legend>
              <div className="quick-chips">
                {QUICK_VIEWS.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    className="quick-chip"
                    aria-pressed={filters.view.includes(v.key)}
                    title={v.title}
                    onClick={() => actions.patch({ filter: filterQuery(toggleFilter(filters, { group: 'view', value: v.key })) })}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <button type="button" className="menu-item" onClick={onRename}>
            <Pencil size={14} aria-hidden="true" /> Rename
          </button>

          <PickerRow label="Colour" current={<><span className="swatch-dot" data-swatch={widget.colour ?? 'none'} aria-hidden="true" />{swatch?.label ?? 'None'}</>}>
            <div className="swatches">
              <button type="button" className="swatch" data-swatch="none" aria-pressed={widget.colour === null} onClick={() => actions.patch({ colour: null })}>
                <span className="swatch-dot" aria-hidden="true" />
                None
              </button>
              {SWATCHES.map((s) => (
                <button key={s.key} type="button" className="swatch" data-swatch={s.key} aria-pressed={widget.colour === s.key} onClick={() => actions.patch({ colour: s.key })}>
                  <span className="swatch-dot" aria-hidden="true" />
                  {s.label}
                </button>
              ))}
            </div>
          </PickerRow>

          <PickerRow label="Icon" current={<span className="picker-emoji">{widget.icon ?? '∅'}</span>}>
            <div className="icon-grid">
              <button type="button" className="icon-choice" aria-pressed={widget.icon === null} onClick={() => actions.patch({ icon: null })} aria-label="No icon">
                ∅
              </button>
              {ICONS.map((icon) => (
                <button key={icon} type="button" className="icon-choice" aria-pressed={widget.icon === icon} onClick={() => actions.patch({ icon })}>
                  {icon}
                </button>
              ))}
            </div>
          </PickerRow>

          {/* Phones stack widgets as sections, so size and stacking apply to desktop and tablet only (proposals §16.3). */}
          {device !== 'phone' && (
            <>
              <fieldset className="menu-group">
                <legend>Size</legend>
                <div className="size-choices">
                  {SIZES.map((s) => (
                    <button key={s} type="button" className="size-choice" title={SIZE_TITLE[s]} aria-pressed={widget.size === s} onClick={() => actions.resize(s)}>
                      {SIZE_LABEL[s]}
                    </button>
                  ))}
                </div>
              </fieldset>
              {actions.stack && (
                <button type="button" className="menu-item" onClick={() => (onClose(), actions.stack?.())}>
                  <Layers size={14} aria-hidden="true" /> Stack under the tile before
                </button>
              )}
              {actions.unstack && (
                <button type="button" className="menu-item" onClick={() => (onClose(), actions.unstack?.())}>
                  <SquareSplitVertical size={14} aria-hidden="true" /> Unstack
                </button>
              )}
            </>
          )}
          {note && (
            <p className="menu-note" role="status">
              {note}
            </p>
          )}

          <button type="button" className="menu-item" onClick={() => (actions.duplicate() ? onClose() : setNote('This page is full. Add a page first.'))}>
            <Copy size={14} aria-hidden="true" /> Duplicate
          </button>
          <button type="button" className="menu-item menu-item-danger" onClick={() => (onClose(), actions.remove())}>
            <Trash2 size={14} aria-hidden="true" /> Remove
          </button>
        </Popover.Content>
      </Popover.Portal>
    </>
  )
}

/** F16: the current choice in a small box with an edit icon; clicking it opens the options in their own picker. */
function PickerRow({ label, current, children }: { label: string; current: ReactNode; children: ReactNode }) {
  const container = useContext(PortalContainer)
  return (
    <div className="picker-row">
      <span className="picker-label">{label}</span>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className="picker-current" aria-label={`Change ${label.toLowerCase()}`}>
            {current}
            <Pencil size={12} aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal container={container}>
          <Popover.Content className="menu picker-menu" side="right" align="start" sideOffset={8} collisionPadding={12} aria-label={label}>
            {children}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
