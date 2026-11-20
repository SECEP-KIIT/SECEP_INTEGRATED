import { Monitor, Moon, Sun } from 'lucide-react'
import { useUpdatePreferences } from '../api/queries'
import type { UiPrefs } from '../api/types'
import { usePrefs } from './prefs'

const CHOICES: { key: NonNullable<UiPrefs['theme']>; label: string; icon: typeof Sun }[] = [
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
  { key: 'auto', label: 'Auto', icon: Monitor },
]

/**
 * Light / Dark / Auto (proposals §16.6, PROPOSED ui_prefs.theme). Auto follows the system setting. Saved through
 * PATCH /me/preferences (optimistic), applied by the lock controller as <html data-theme>. The Settings page takes it
 * over in task 16; for now it sits in the avatar menu (and on the phone's More page). A radio group: each choice has
 * an icon and a name, so the state is never colour alone.
 */
export function ThemeChoice() {
  const { theme } = usePrefs()
  const update = useUpdatePreferences()
  return (
    <fieldset className="theme-choice">
      <legend>Theme</legend>
      <div className="theme-options">
      {CHOICES.map(({ key, label, icon: Icon }) => (
        <label key={key} className="theme-option" data-checked={theme === key || undefined}>
          <input type="radio" name="theme" value={key} checked={theme === key} onChange={() => update.mutate({ theme: key })} />
          <Icon size={15} aria-hidden="true" />
          {label}
        </label>
      ))}
      </div>
    </fieldset>
  )
}
