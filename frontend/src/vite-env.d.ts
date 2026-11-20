interface ImportMetaEnv {
  /** Dev only: "1" starts MSW mocks (see .env.example). Ignored in production builds. */
  readonly VITE_MOCK?: string
  /** Dev only: "1" persists user-made mock state in localStorage (versioned; secrets never saved). */
  readonly VITE_MOCK_PERSIST?: string
}
