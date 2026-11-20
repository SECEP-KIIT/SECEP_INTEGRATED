import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { LayoutPage, Widget } from '../api/types'
import { moveWidget, patchWidget, widgetTitle } from './layoutModel'

/**
 * Editing a page on the phone (FR-UI-009 as changed in proposals §16.4): a bottom sheet listing the page's
 * sections, each with a drag handle to reorder it and a switch to show or hide it, plus Add widget, and the page's
 * name and Delete. It replaces the 8b long-press / ghost-slot editor. A native modal <dialog>: focus is trapped and
 * Esc closes it. Every change saves like any layout edit (debounced PUT).
 */
export function PhoneEditSheet({ page, canDelete, status, onChange, onRename, onAdd, onDelete, onClose }: {
  page: LayoutPage
  canDelete: boolean
  status: string
  onChange: (page: LayoutPage) => void
  onRename: (name: string) => void
  onAdd: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = page.widgets.map((w) => w.id)

  return (
    <dialog ref={ref} className="edit-sheet" aria-labelledby="edit-sheet-title" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current.close()}>
      <div className="edit-sheet-head">
        <h2 id="edit-sheet-title">Edit page</h2>
        <span className="dash-save" role="status">
          {status}
        </span>
        <button type="button" className="primary-button" onClick={() => ref.current?.close()}>
          Done
        </button>
      </div>

      <label className="edit-sheet-field">
        <span>Page name</span>
        <input
          className="dash-page-name"
          defaultValue={page.name}
          key={page.id}
          maxLength={40}
          onBlur={(e) => onRename(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>

      <h3 className="edit-sheet-sub">Sections</h3>
      {page.widgets.length === 0 ? (
        <p className="drawer-muted">No sections yet. Add a widget.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (over) onChange(moveWidget(page, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))))
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="edit-sheet-list">
              {page.widgets.map((w) => (
                <SectionRow key={w.id} widget={w} onToggle={() => onChange(patchWidget(page, w.id, { hidden: !w.hidden }))} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <div className="edit-sheet-actions">
        <button type="button" className="ghost-button" onClick={onAdd}>
          <Plus size={14} aria-hidden="true" /> Add widget
        </button>
        <button type="button" className="ghost-button danger-button" disabled={!canDelete} onClick={onDelete}>
          <Trash2 size={14} aria-hidden="true" /> Delete page
        </button>
      </div>
    </dialog>
  )
}

function SectionRow({ widget, onToggle }: { widget: Widget; onToggle: () => void }) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id: widget.id })
  const title = widgetTitle(widget)
  return (
    <li
      ref={setNodeRef}
      className="edit-sheet-row"
      data-dragging={isDragging || undefined}
      data-hidden={widget.hidden || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button type="button" className="drag-handle" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Move ${title}`}>
        <GripVertical size={18} aria-hidden="true" />
      </button>
      <span className="edit-sheet-name">
        {widget.icon && <span aria-hidden="true">{widget.icon} </span>}
        {title}
      </span>
      {/* A switch with its state in words, not colour alone. */}
      <label className="switch">
        <input type="checkbox" role="switch" checked={!widget.hidden} onChange={onToggle} />
        <span className="switch-text">{widget.hidden ? 'Hidden' : 'Shown'}</span>
        <span className="sr-only"> {title}</span>
      </label>
    </li>
  )
}
