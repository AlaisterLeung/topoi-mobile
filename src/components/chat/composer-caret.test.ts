// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://localhost/"}
/**
 * The composer's text has to be readable the moment `setText` returns.
 *
 * `ComposerPrimitive.Input` paints its value out of the composer store, so a reader that renders between a keystroke and the store's publish draws the text the
 * user already replaced: React writes that stale string back over the DOM value, and a value assignment puts the caret at the end of the message. `draft-sync.tsx`
 * is exactly such a reader - it mirrors `state.composer.text` into the screen's own state on every change, which renders the composer again - so an edit made in
 * the middle of a message jumped the caret to the end, and a streaming turn gave it the extra renders to do it mid-reply.
 *
 * Named .test.ts with no JSX on purpose: the vitest config collects only .test.ts files under src, so a rename to .tsx silently stops it running.
 */
import { createElement, useEffect, useState } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  type ThreadMessageLike,
  useAui,
  useAuiState,
  useExternalStoreRuntime
} from '@assistant-ui/react'

import { ComposerDraftSync } from './draft-sync'

/** React 19 refuses to flush work inside `act` without this. */
const view = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
view.IS_REACT_ACT_ENVIRONMENT = true

/** jsdom has neither, and the composer's input touches both. */
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    }) as unknown as MediaQueryList
}
if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

/** Handles out of the tree: the composer's API, the text a state reader sees, and the draft the screen keeps. */
interface Probes {
  aui: ReturnType<typeof useAui> | null
  seen: string
  draft: string
}

function Handle({ probes }: { probes: Probes }) {
  probes.aui = useAui()
  return null
}

function Reader({ probes }: { probes: Probes }) {
  const text = useAuiState(state => state.composer.text)
  useEffect(() => {
    probes.seen = text
  }, [probes, text])
  return null
}

/** The chat screen's shape: the real draft bridge, a composer, and the screen state the bridge writes into on every change. */
function Screen({ probes }: { probes: Probes }) {
  const [draft, setDraft] = useState('')
  probes.draft = draft
  // Empty, and typed: a bare [] infers never and the adapter rejects it.
  const messages: ThreadMessageLike[] = []
  const runtime = useExternalStoreRuntime({
    convertMessage: message => message,
    messages,
    isRunning: false,
    onNew: async () => {}
  })
  return createElement(
    AssistantRuntimeProvider,
    { runtime },
    createElement(Handle, { probes }),
    createElement(Reader, { probes }),
    createElement(ComposerDraftSync, { draftText: '', sent: 0, onChange: setDraft }),
    createElement(ComposerPrimitive.Root, null, createElement(ComposerPrimitive.Input, { submitMode: 'none' }))
  )
}

interface Mounted {
  host: HTMLDivElement
  root: Root
  probes: Probes
}

function mount(): Mounted {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  return { host, root, probes: { aui: null, seen: '', draft: '' } }
}

/** One keystroke in the middle of the message, the way the platform delivers it: the new value and the caret, then the input event. */
function insert(textarea: HTMLTextAreaElement, value: string, caret: number): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setter?.call(textarea, value)
    textarea.setSelectionRange(caret, caret)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Render, and hand back the textarea the composer painted: every keystroke below needs it. */
async function render(screen: Mounted): Promise<HTMLTextAreaElement> {
  await act(async () => {
    screen.root.render(createElement(Screen, { probes: screen.probes }))
  })
  const textarea = screen.host.querySelector('textarea')
  if (!textarea) throw new Error('the composer painted no textarea')
  return textarea
}

function unmount(screen: Mounted): void {
  act(() => screen.root.unmount())
  screen.host.remove()
}

describe('composer text publication', () => {
  /** The contract `draft-sync.tsx` stands on: a write is readable before the call returns, so the next render cannot draw the text it replaced. Read inside
   *  the act body on purpose - after the flush every version agrees, and a green test there would prove nothing. */
  it('reads the new text back as soon as setText returns', async () => {
    const screen = mount()
    await render(screen)
    let immediate = ''
    act(() => {
      screen.probes.aui?.composer.setText('hello world')
      immediate = screen.probes.aui?.composer.getState().text ?? ''
    })
    expect(immediate).toBe('hello world')
    expect(screen.probes.aui?.composer.getState().text).toBe('hello world')
    expect(screen.probes.seen).toBe('hello world')
    unmount(screen)
  })

  /** The behaviour the screen owes the reader: an edit in the middle keeps the caret there. A browser that paints the published text may pass this on the old
   *  version while the store was still behind, so it guards the app's own tree rather than proving the library defect. */
  it('keeps the caret where the text was edited', async () => {
    const screen = mount()
    const textarea = await render(screen)
    insert(textarea, 'hello world', 11)
    expect(textarea.value).toBe('hello world')
    insert(textarea, 'helloX world', 7)
    expect(textarea.value).toBe('helloX world')
    expect(textarea.selectionStart).toBe(7)
    unmount(screen)
  })
})
