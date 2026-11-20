import { CardSheetHost } from './CardSheet'
import { QuickAddHost } from './QuickAdd'
import '../inbox/inbox.css'
import '../projects/projects.css'
import './cards.css'

/** Quick-add and the card sheet: one chunk, loaded on the first request (NFR-PERF-010). */
export function CardsHost() {
  return (
    <>
      <QuickAddHost />
      <CardSheetHost />
    </>
  )
}
