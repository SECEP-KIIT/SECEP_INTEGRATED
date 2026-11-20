import { parseMasked, secretLabel } from '../lib/masked'

export function MaskedText({ text }: { text: string }) {
  return parseMasked(text).map((seg, i) =>
    'text' in seg ? (
      seg.text
    ) : (
      <span key={i} className="masked">
        <span aria-hidden="true">🔒</span> {secretLabel(seg.secretType)} hidden
      </span>
    ),
  )
}
