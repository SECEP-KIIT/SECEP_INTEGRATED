// Boot entry: the only script in index.html. It's tiny, so the static lock screen gets its clock and wallpaper
// while the app is still downloading (FR-WP-002, NFR-PERF-012). It's an external module, not an inline script,
// because the CSP forbids inline scripts (NFR-SEC-008).
//
// The app is a dynamic import so it becomes its own chunk. lock.ts stays in this entry chunk only, so the app imports
// the SAME controller instance (one state machine). A modulepreload link added at build time (vite.config.ts)
// starts the app download in parallel, so the dynamic import costs no extra round trip.
import { watchDevice } from '../lib/breakpoints'
import { initLock } from './lock'
import { startWallpaper } from './wallpaper'

watchDevice() // <html data-device> for the CSS, before the app paints
startWallpaper()
initLock()
void import('../main')
