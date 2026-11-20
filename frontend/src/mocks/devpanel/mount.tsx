import { createRoot } from 'react-dom/client'
import { DevPanel } from './DevPanel'

// Its own root outside #root, so the lock screen's `inert` on the app doesn't disable it.
const host = document.createElement('div')
document.body.append(host)
createRoot(host).render(<DevPanel />)
