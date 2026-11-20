import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/app.css'
import App from './App.tsx'

// MSW is dev-only: import.meta.env.DEV is a build-time constant, so in production this branch and the dynamic
// import() are removed entirely and no mock code ships.
async function enableMocking() {
  if (!import.meta.env.DEV || import.meta.env.VITE_MOCK !== '1') return
  const { worker } = await import('./mocks/browser')
  // Unmatched /api/v1 paths get a 404 from the mock's own catch-all; everything else (Vite assets, HMR) passes.
  await worker.start({ onUnhandledRequest: 'bypass' })
  // Mock controls (Ctrl+Shift+D), dev only like the mocks themselves.
  void import('./mocks/devpanel/mount')
}

enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
