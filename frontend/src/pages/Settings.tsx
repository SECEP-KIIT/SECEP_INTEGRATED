import { useLocation } from 'react-router'
import { CHECKLIST, markDone, saveOnboarding, startTour, useOnboarding } from '../onboarding/onboarding'
import { BellRing, GraduationCap, Keyboard, Lock, Monitor, Moon, Palette, Sparkles, Sun, SunMedium } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { useUpdatePreferences } from '../api/queries'
import type { UiPrefs } from '../api/types'
import { comboOf, comboProblem, defaultOf, display, isCombo, KEY_ACTIONS, overridesOf, resolveBindings, usedBy, type KeyActionId } from '../lib/keybinds'
import { DEFAULT_QUIET, LEVELS, SENTIMENTS, type PopupMode, type PopupRule, type PopupRules } from '../lib/popupRules'
import { usePrefs } from '../shell/prefs'
import './settings.css'

/**
 * Settings (task 16, lean): the preferences stored in ui_prefs through PATCH /me/preferences (§6.5), saved as soon as
 * they change (optimistic, like the theme menu). Theme and motion (FR-UI-032), lock screen and idle return
 * (FR-WP-001/004), lock-screen subjects, pop-up rules and quiet hours (FR-REM-007, §28.1), key binds (§28.3).
 * Wallpaper places with photos and the weather chip (FR-WP-006–009), digest and reminder defaults are v2.
 */
export function Component() {
  const prefs = usePrefs()
  const update = useUpdatePreferences()
  const set = (patch: UiPrefs) => update.mutate(patch)
  // /settings#notifications (the first-run toast's Change) and #keyboard land on their section.
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [hash])

  return (
    <div className="settings">
      <Section icon={<Palette size={18} aria-hidden="true" />} title="Appearance">
        <Choice
          label="Theme"
          value={prefs.theme}
          options={[
            { key: 'light', label: 'Light', icon: <Sun size={15} aria-hidden="true" /> },
            { key: 'dark', label: 'Dark', icon: <Moon size={15} aria-hidden="true" /> },
            { key: 'auto', label: 'Auto', icon: <Monitor size={15} aria-hidden="true" /> },
          ]}
          hint="Auto follows your computer's light or dark setting."
          onChange={(theme) => set({ theme })}
        />
        <Choice
          label="Motion"
          value={prefs.motion ?? 'system'}
          options={[
            { key: 'system', label: 'System' },
            { key: 'full', label: 'Full' },
            { key: 'reduced', label: 'Reduced' },
            { key: 'off', label: 'Off' },
          ]}
          hint="Reduced swaps movement for quick fades and keeps the glow still. System follows your computer's reduce-motion setting."
          onChange={(m) => set({ motion: m === 'system' ? null : m })}
        />
        <Toggle label="Start with the sidebar collapsed" checked={prefs.sidebar_collapsed} onChange={(v) => set({ sidebar_collapsed: v })} />
      </Section>

      <Section icon={<Lock size={18} aria-hidden="true" />} title="Lock screen">
        <Toggle label="Skip the lock screen when SECEP opens" checked={prefs.skip_lock} onChange={(v) => set({ skip_lock: v })} />
        <Choice
          label="Return to the lock screen after"
          value={String(prefs.idle_minutes ?? 'off')}
          options={[
            { key: 'off', label: 'Never' },
            { key: '5', label: '5 min' },
            { key: '15', label: '15 min' },
            { key: '30', label: '30 min' },
            { key: '60', label: '1 h' },
          ]}
          hint="A privacy curtain that hides your mail when you step away. It isn't a password lock: your computer's own lock is."
          onChange={(v) => set({ idle_minutes: v === 'off' ? null : Number(v) })}
        />
        <Toggle
          label="Show subjects and event titles on the lock screen"
          checked={prefs.glance_subjects}
          hint="Off: the lock screen shows counts only, so people walking past can't read your mail."
          onChange={(v) => set({ glance_subjects: v })}
        />
      </Section>

      <Section icon={<BellRing size={18} aria-hidden="true" />} title="Notifications" id="notifications">
        <PopupTable rules={prefs.popup_rules} onChange={(popup_rules) => (markDone('popup_rules'), set({ popup_rules }))} />
        <QuietHoursRow value={prefs.quiet_hours} onChange={(quiet_hours) => (quiet_hours && markDone('quiet_hours'), set({ quiet_hours }))} />
      </Section>

      <Section icon={<Keyboard size={18} aria-hidden="true" />} title="Keyboard shortcuts" id="keyboard">
        <KeybindList overrides={prefs.keybinds} onChange={(keybinds) => set({ keybinds })} />
      </Section>

      <Section icon={<GraduationCap size={18} aria-hidden="true" />} title="Tutorial" id="tutorial">
        <TutorialRow />
      </Section>

      <Section icon={<SunMedium size={18} aria-hidden="true" />} title="Wallpaper">
        <p className="settings-note">The wallpaper follows the sun through dawn, day, golden hour, dusk and night. Your own photos and places come in a later version.</p>
      </Section>

      <Section icon={<Sparkles size={18} aria-hidden="true" />} title="About">
        <p className="settings-note">SECEP, the Smart Email Classifier. KIIT B.Tech CSE major project, 2026.</p>
      </Section>

      {update.isError && (
        <p className="settings-error" role="alert">
          Couldn't save that change. Try again.
        </p>
      )}
    </div>
  )
}

function Section({ icon, title, id: anchor, children }: { icon: ReactNode; title: string; id?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="settings-section" aria-labelledby={id} id={anchor}>
      <h2 id={id}>
        {icon}
        {title}
      </h2>
      <div className="settings-rows">{children}</div>
    </section>
  )
}

/** A segmented radio group: each choice has a name (and maybe an icon), so the state is never colour alone. */
function Choice<K extends string>({ label, value, options, hint, onChange }: { label: string; value: K; options: { key: K; label: string; icon?: ReactNode }[]; hint?: string; onChange: (k: K) => void }) {
  const name = useId()
  return (
    <fieldset className="settings-row">
      <legend>{label}</legend>
      <div className="theme-options settings-choice">
        {options.map((o) => (
          <label key={o.key} className="theme-option" data-checked={value === o.key || undefined}>
            <input type="radio" name={name} value={o.key} checked={value === o.key} onChange={() => onChange(o.key)} />
            {o.icon}
            {o.label}
          </label>
        ))}
      </div>
      {hint && <p className="settings-hint">{hint}</p>}
    </fieldset>
  )
}

function Toggle({ label, checked, hint, onChange }: { label: string; checked: boolean; hint?: string; onChange: (v: boolean) => void }) {
  const hintId = useId()
  return (
    <div className="settings-row">
      <label className="settings-toggle">
        <span>{label}</span>
        <input type="checkbox" role="switch" checked={checked} aria-describedby={hint ? hintId : undefined} onChange={(e) => onChange(e.target.checked)} />
      </label>
      {hint && (
        <p id={hintId} className="settings-hint">
          {hint}
        </p>
      )}
    </div>
  )
}

const MODES: { key: PopupMode; label: string; hint: string }[] = [
  { key: 'normal', label: 'Normal', hint: 'Most of the day' },
  { key: 'focus', label: 'Focus mode', hint: 'While Focus is on' },
  { key: 'quiet', label: 'Quiet hours', hint: 'The times below' },
]

/**
 * FR-REM-007: per mode, which urgencies pop up, and whether an upset email pops up whatever its urgency. Emails that
 * don't pop up still arrive in the inbox and count on the bell; they just don't interrupt.
 */
function PopupTable({ rules, onChange }: { rules: PopupRules; onChange: (r: PopupRules) => void }) {
  const set = (mode: PopupMode, patch: Partial<PopupRule>) => onChange({ ...rules, [mode]: { ...rules[mode], ...patch } })
  return (
    <div className="settings-row">
      <table className="popup-table">
        <caption>Which new emails pop up</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Urgency</th>
            <th scope="col">Also if the mood is</th>
          </tr>
        </thead>
        <tbody>
          {MODES.map((m) => (
            <tr key={m.key}>
              <th scope="row">
                {m.label}
                <span className="settings-hint">{m.hint}</span>
              </th>
              <td>
                <select onClick={() => markDone('popup_rules')} aria-label={`${m.label}: urgency that pops up`} value={rules[m.key].urgency} onChange={(e) => set(m.key, { urgency: e.target.value as PopupRule['urgency'] })}>
                  {LEVELS.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select onClick={() => markDone('popup_rules')} aria-label={`${m.label}: also pop up when the mood is`} value={rules[m.key].sentiment} onChange={(e) => set(m.key, { sentiment: e.target.value as PopupRule['sentiment'] })}>
                  {SENTIMENTS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="settings-hint">Everything else arrives quietly: it is in your inbox and on the bell, without a pop-up. Quiet hours win over Focus mode.</p>
    </div>
  )
}

function QuietHoursRow({ value, onChange }: { value: { start: string; end: string } | null; onChange: (v: { start: string; end: string } | null) => void }) {
  const on = value !== null
  const v = value ?? DEFAULT_QUIET
  return (
    <div className="settings-row">
      <label className="settings-toggle">
        <span>Quiet hours</span>
        <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked ? DEFAULT_QUIET : null)} />
      </label>
      {on && (
        <div className="quiet-times">
          <label>
            From <input type="time" value={v.start} required onChange={(e) => e.target.value && onChange({ ...v, start: e.target.value })} />
          </label>
          <label>
            to <input type="time" value={v.end} required onChange={(e) => e.target.value && onChange({ ...v, end: e.target.value })} />
          </label>
        </div>
      )}
      <p className="settings-hint">Your computer's local time. A range past midnight, like 22:00 to 08:00, is fine.</p>
    </div>
  )
}

/**
 * Proposals §28.3: every editable shortcut with its key. Change listens for the next key press (Esc cancels); a key
 * another action uses, or one kept for its usual job (Esc, Enter, arrows, Ctrl/⌘+C…), is refused with a reason.
 * Saved per person in ui_prefs.keybinds (overrides only).
 */
function KeybindList({ overrides, onChange }: { overrides: Partial<Record<KeyActionId, string>>; onChange: (o: Partial<Record<KeyActionId, string>>) => void }) {
  const bindings = resolveBindings(overrides)
  const [listening, setListening] = useState<KeyActionId | null>(null)
  const [problem, setProblem] = useState<{ id: KeyActionId; text: string } | null>(null)

  useEffect(() => {
    if (!listening) return
    // Capture phase, ahead of every other shortcut handler, so the key only sets the bind.
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') return setListening(null)
      const combo = comboOf(e)
      if (!combo) return // a lone modifier: keep listening
      const clash = usedBy(bindings, combo, listening)
      const why = !isCombo(combo) ? `${display(combo)} can't be used` : (comboProblem(combo) ?? (clash ? `${display(combo)} is already ${KEY_ACTIONS.find((a) => a.id === clash)?.label}` : null))
      setListening(null)
      if (why) return setProblem({ id: listening, text: why })
      setProblem(null)
      onChange(overridesOf({ ...bindings, [listening]: combo }))
    }
    addEventListener('keydown', onKey, { capture: true })
    return () => removeEventListener('keydown', onKey, { capture: true })
  }, [listening, bindings, onChange])

  const changed = Object.keys(overrides).length > 0
  return (
    <div className="settings-row">
      {(['App', 'Cards'] as const).map((group) => (
        <table key={group} className="keybind-table">
          <caption>{group === 'App' ? 'Anywhere' : 'On a focused card'}</caption>
          <tbody>
            {KEY_ACTIONS.filter((a) => a.group === group).map((a) => (
              <tr key={a.id}>
                <th scope="row">{a.label}</th>
                <td>
                  <kbd>{display(bindings[a.id])}</kbd>
                </td>
                <td className="keybind-buttons">
                  <button type="button" className="ghost-button" aria-pressed={listening === a.id} onClick={() => (setProblem(null), setListening(listening === a.id ? null : a.id))}>
                    {listening === a.id ? 'Press a key… (Esc cancels)' : 'Change'}
                  </button>
                  {bindings[a.id] !== defaultOf(a.id) && (
                    <button type="button" className="text-button" onClick={() => onChange(overridesOf({ ...bindings, [a.id]: defaultOf(a.id) }))}>
                      Reset to {display(defaultOf(a.id))}
                    </button>
                  )}
                  {problem?.id === a.id && (
                    <span className="settings-error" role="alert">
                      {problem.text}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <p className="settings-hint">Keys without Ctrl, ⌘ or Alt never fire while you're typing. Esc, Enter, the arrows and Ctrl/⌘+C keep their usual jobs.</p>
      {changed && (
        <button type="button" className="text-button keybind-reset-all" onClick={() => onChange({})}>
          Reset all shortcuts
        </button>
      )}
    </div>
  )
}

/** Proposals §29: start or resume the tour, bring back Getting started, show the tips again. */
function TutorialRow() {
  const o = useOnboarding()
  if (!o) return null
  const paused = o.tour === 'paused' && (o.tour_step ?? 0) > 0
  const done = o.done?.length ?? 0
  return (
    <div className="settings-row">
      <div className="tutorial-buttons">
        <button type="button" className="primary-button" onClick={() => startTour(0)}>
          Start the tour
        </button>
        {paused && (
          <button type="button" className="ghost-button" onClick={() => startTour(o.tour_step)}>
            Resume from step {(o.tour_step ?? 0) + 1}
          </button>
        )}
        {o.checklist_hidden && done < CHECKLIST.length && (
          <button type="button" className="ghost-button" onClick={() => saveOnboarding({ checklist_hidden: false })}>
            Show Getting started on Home ({done} of {CHECKLIST.length} done)
          </button>
        )}
        {(o.hints?.length ?? 0) > 0 && (
          <button type="button" className="text-button" onClick={() => saveOnboarding({ hints: [] })}>
            Show tips again
          </button>
        )}
      </div>
      <p className="settings-hint">A one-minute tour of where things are. You can also start it by searching "tutorial".</p>
    </div>
  )
}
