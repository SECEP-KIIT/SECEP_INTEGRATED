import { Hint, Key } from '../onboarding/Hint'
import { Board } from '../board/Board'
import { InboxHost } from '../inbox/InboxHost'

/** The Board full view (FR-ORC-007): every card of the user's, in To do · In progress · Done. */
export function Component() {
  return (
    <InboxHost>
      <div className="board-page">
        <Board label="Board" />
      </div>
      <Hint id="remind" target=".board-item">
        Tip: hover a card and click ⏰, or press <Key id="remind" />, to be reminded about it later.
      </Hint>
    </InboxHost>
  )
}
