import { useAui, useAuiState } from '@assistant-ui/react'
import { useEffect, useRef } from 'react'

/** The bridge between a draft and the composer's own store.
 *
 *  The composer keeps its text inside assistant-ui, not in this app's state, so
 *  a draft cannot be handed to it as a value: it goes in once, when the screen
 *  mounts, through the runtime's own setter, and every change the store reports
 *  is handed back out to be kept. The written text is never fed in again, so
 *  typing is never fought over.
 *
 *  This has to be rendered inside the runtime provider, which is why it is a
 *  component of its own with nothing to draw. */
export function ComposerDraftSync({
  draftText,
  sent,
  onChange
}: {
  /** What the surface held when this screen mounted, empty when it held nothing. */
  draftText: string
  /** Counts accepted sends: the composer's own clear on send is not guaranteed
   *  to land before the chat writes its draft back, so the clear is asked for
   *  here as well. */
  sent: number
  onChange: (text: string) => void
}) {
  const aui = useAui()
  const text = useAuiState(state => state.composer.text)
  const hydrated = useRef(false)

  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    if (draftText) aui.composer.setText(draftText)
  }, [aui, draftText])

  useEffect(() => {
    if (sent > 0) aui.composer.setText('')
  }, [aui, sent])

  useEffect(() => {
    onChange(text)
  }, [onChange, text])

  return null
}
