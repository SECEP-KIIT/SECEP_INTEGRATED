// Navigation from outside React's tree (a toast's button, a module-level action). The shell listens and routes.
const EVENT = 'secep:navigate'

export const goTo = (path: string) => dispatchEvent(new CustomEvent<string>(EVENT, { detail: path }))

export function onGoTo(fn: (path: string) => void) {
  const handler = (e: Event) => fn((e as CustomEvent<string>).detail)
  addEventListener(EVENT, handler)
  return () => removeEventListener(EVENT, handler)
}

/** The dashboard page that shows Handled mail (QA pass 5): `/?page=handled`. */
export const HANDLED_PAGE_HREF = '/?page=handled'
