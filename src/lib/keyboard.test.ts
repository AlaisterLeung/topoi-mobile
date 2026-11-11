import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The shell the keyboard module writes to, plus the frame height the native resize moves: `window.innerHeight` follows the webview's frame, so the fake lets a test shrink it the way the plugin does. */
interface Shell {
  style: Map<string, string>
  attrs: Set<string>
  resizeFrame: (height: number) => void
}

function stubShell(height: number): Shell {
  const style = new Map<string, string>()
  const attrs = new Set<string>()
  const frame = { height }
  const root = {
    setAttribute: (name: string): void => void attrs.add(name),
    removeAttribute: (name: string): void => void attrs.delete(name),
    hasAttribute: (name: string): boolean => attrs.has(name)
  }
  vi.stubGlobal('window', {
    get innerHeight(): number {
      return frame.height
    },
    addEventListener: (): void => {}
  })
  vi.stubGlobal('document', {
    documentElement: {
      style: {
        setProperty: (name: string, value: string): void => void style.set(name, value),
        removeProperty: (name: string): void => void style.delete(name)
      }
    },
    getElementById: (): typeof root => root
  })
  return {
    style,
    attrs,
    resizeFrame: (next: number): void => {
      frame.height = next
    }
  }
}

async function loadKeyboard(): Promise<typeof import('./keyboard')> {
  vi.resetModules()
  return import('./keyboard')
}

const FULL = 844
const QWERTY = 336
const CJK = 360

describe('keyboard shell height', () => {
  let shell: Shell

  beforeEach(() => {
    shell = stubShell(FULL)
  })

  it('pins the shell to the area the keyboard leaves visible', async () => {
    const keyboard = await loadKeyboard()
    keyboard.showKeyboard(QWERTY)
    expect(shell.style.get('--visible-height')).toBe(`${FULL - QWERTY}px`)
    expect(shell.attrs.has('data-keyboard')).toBe(true)
  })

  it('charges a re-reported keyboard once, not twice, after the frame has shrunk', async () => {
    const keyboard = await loadKeyboard()
    keyboard.showKeyboard(QWERTY)
    // The plugin's native resize lands after the animation: the frame is now the visible area.
    shell.resizeFrame(FULL - QWERTY)
    keyboard.syncKeyboardFrame()
    expect(shell.style.get('--visible-height')).toBe(`${FULL - QWERTY}px`)
    // Switching language re-reports the keyboard while the frame is still shrunk (a taller IME, a candidate row).
    keyboard.showKeyboard(QWERTY)
    expect(shell.style.get('--visible-height')).toBe(`${FULL - QWERTY}px`)
    keyboard.showKeyboard(CJK)
    expect(shell.style.get('--visible-height')).toBe(`${FULL - CJK}px`)
  })

  it('takes the frame as the measurement once it has resized under a keyboard', async () => {
    const keyboard = await loadKeyboard()
    keyboard.showKeyboard(QWERTY)
    shell.resizeFrame(500)
    keyboard.syncKeyboardFrame()
    expect(shell.style.get('--visible-height')).toBe('500px')
  })

  it('hands the shell back on hide and re-learns the resting height', async () => {
    const keyboard = await loadKeyboard()
    keyboard.showKeyboard(QWERTY)
    keyboard.hideKeyboard()
    expect(shell.style.has('--visible-height')).toBe(false)
    expect(shell.attrs.has('data-keyboard')).toBe(false)
    // The frame grows back a moment after the hide event, and the next show must subtract from the full height again.
    shell.resizeFrame(FULL)
    keyboard.syncKeyboardFrame()
    keyboard.showKeyboard(CJK)
    expect(shell.style.get('--visible-height')).toBe(`${FULL - CJK}px`)
  })

  it('treats a zero-height report as the keyboard being gone', async () => {
    const keyboard = await loadKeyboard()
    keyboard.showKeyboard(QWERTY)
    keyboard.showKeyboard(0)
    expect(shell.style.has('--visible-height')).toBe(false)
    expect(shell.attrs.has('data-keyboard')).toBe(false)
  })
})
