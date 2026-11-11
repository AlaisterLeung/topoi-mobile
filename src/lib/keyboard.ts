import { Capacitor } from '@capacitor/core'
import { Keyboard, KeyboardResize } from '@capacitor/keyboard'

/** The webview is full-bleed, so iOS BOTH overlays the keyboard and scrolls the page to reveal whatever was focused: the shell stays as tall as the layout viewport while the webview is scrolled up by the keyboard's height, which leaves the composer floating mid-screen with a band of empty background under it. Native resize is the platform's own answer: the webview's frame shrinks by the keyboard's height, so the shell follows it and the composer sits on top of the keyboard with nothing scrolled at all. Scroll is disabled as well, which also pins the scroll offset to zero. The form accessory bar is WebKit's, with arrows and a tick that mean nothing over a chat composer. A browser has no plugin and keeps its default. */
export async function pinKeyboardLayout(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  // The frame moves too, and it is the only writer that knows what the keyboard left behind, so its own event is a second measurement of the same thing.
  window.addEventListener('resize', syncKeyboardFrame)
  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native })
    await Keyboard.setScroll({ isDisabled: true })
    await Keyboard.setAccessoryBarVisible({ isVisible: false })
    // The frame resize is LATE BY DESIGN (`keyboardAnimationDuration + 0.2` in the plugin's Keyboard.m), so the shell is driven by the keyboard's own events instead: they fire as it starts moving, and the shell's height transition runs for the same 250ms, so the composer travels with it.
    await Keyboard.addListener('keyboardWillShow', info => showKeyboard(info.keyboardHeight))
    await Keyboard.addListener('keyboardDidShow', info => showKeyboard(info.keyboardHeight))
    await Keyboard.addListener('keyboardWillHide', () => hideKeyboard())
  } catch {
    // An older shell without the plugin keeps WebKit's behaviour rather than failing the boot.
  }
}

/** The frame's height with NO keyboard up. Native resize shrinks the frame itself, so while a keyboard is up `window.innerHeight` is ALREADY the visible area: subtracting the keyboard from it a second time charges a whole keyboard twice, and that is exactly what a language switch did, because switching re-reports the keyboard while the frame is still shrunk (taller IME, candidate row), so the shell came up one keyboard short and stayed there. */
let restHeight = Math.round(window.innerHeight)

/** Pin the shell to the area the keyboard leaves visible. Idempotent on purpose: a repeat report of the same keyboard, in either order relative to the frame's own resize, writes the same height. */
export function showKeyboard(keyboardHeight: number): void {
  const keyboard = Math.round(keyboardHeight)
  // A 0 report means nothing covers the shell (an iPad QuickType bar is reported as 0): marking it keyed-up at full height would drop the home-indicator inset with nothing covering it.
  if (keyboard <= 0) {
    hideKeyboard()
    return
  }
  const visible = Math.max(0, restHeight - keyboard)
  document.documentElement.style.setProperty('--visible-height', `${visible}px`)
  document.getElementById('root')?.setAttribute('data-keyboard', 'up')
}

/** Hand the shell back to the layout viewport. The frame has not grown back yet a few milliseconds after this event, so the property is REMOVED rather than set to the current height: `100%` follows the frame as it returns, and the same transition carries the composer down with the keyboard. */
export function hideKeyboard(): void {
  document.documentElement.style.removeProperty('--visible-height')
  document.getElementById('root')?.removeAttribute('data-keyboard')
}

/** Follow the frame when it resizes under its own steam (the native resize landing, or the frame returning on a hide). With a keyboard up the shrunken frame IS the visible area, so its height is the measurement to trust; with no keyboard up the frame is the resting height, and the next show starts subtracting from that. */
export function syncKeyboardFrame(): void {
  const height = Math.round(window.innerHeight)
  if (!document.getElementById('root')?.hasAttribute('data-keyboard')) {
    restHeight = height
    return
  }
  document.documentElement.style.setProperty('--visible-height', `${height}px`)
}

/** The browser half, and the backstop for a shell whose keyboard events never arrive: `--visible-height` tracks `visualViewport`, the one measurement that needs no event at all. Native leaves it to the keyboard events above, so the two writers never fight over the same transition. */
export function pinVisibleViewport(): () => void {
  if (Capacitor.isNativePlatform()) return () => {}
  const viewport = window.visualViewport
  if (!viewport) return () => {}
  const apply = () => {
    document.documentElement.style.setProperty('--visible-height', `${Math.round(viewport.height)}px`)
  }
  apply()
  viewport.addEventListener('resize', apply)
  viewport.addEventListener('scroll', apply)
  return () => {
    viewport.removeEventListener('resize', apply)
    viewport.removeEventListener('scroll', apply)
  }
}
