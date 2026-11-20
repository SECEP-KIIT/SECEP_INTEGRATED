import { QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, Navigate } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { queryClient } from './api/queries'
import { Shell } from './shell/Shell'

// Every page is a lazy route (its own chunk, NFR-PERF-010); the shell stays in the main bundle.
// `handle.title` feeds the topbar. While the route chunks load, the static lock screen covers everything.

const router = createBrowserRouter([
  {
    path: '/',
    Component: Shell,
    hydrateFallbackElement: <></>,
    children: [
      // The paged dashboard (FR-UI-007). To point / back at the single inbox column, use this line instead:
      //   { index: true, element: <Navigate to="/inbox" replace /> },
      { index: true, lazy: () => import('./pages/Dashboard'), handle: { title: 'Home' } },
      { path: 'inbox', lazy: () => import('./pages/Inbox'), handle: { title: 'Inbox' } },
      { path: 'board', lazy: () => import('./pages/Board'), handle: { title: 'Board' } },
      { path: 'security', lazy: () => import('./pages/Security'), handle: { title: 'Security' } },
      // Metrics is the Stats widget on Home now (19 Nov 2026); old links land there.
      { path: 'metrics', element: <Navigate to="/" replace /> },
      // Calendar is v2 (19 Nov 2026); an old link lands on Home.
      { path: 'calendar', element: <Navigate to="/" replace /> },
      { path: 'projects/:id', lazy: () => import('./pages/Project'), handle: { title: 'Project' } },
      { path: 'settings', lazy: () => import('./pages/Settings'), handle: { title: 'Settings' } },
      { path: 'admin', lazy: () => import('./pages/Admin'), handle: { title: 'Admin' } },
      { path: 'more', lazy: () => import('./pages/More'), handle: { title: 'More' } },
    ],
  },
])

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
