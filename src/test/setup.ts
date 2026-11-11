/** The `localStorage` the config and cache modules read directly. Node exposes one as an accessor that answers undefined and warns unless it was started with a storage file, so the shim goes over that accessor rather than reading it. The modules under test are framework-free, so this beats pulling in a DOM. */
const entries = new Map<string, string>()

const existing = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

if (!existing || existing.get) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      get length(): number {
        return entries.size
      },
      clear: (): void => entries.clear(),
      getItem: (key: string): string | null => entries.get(key) ?? null,
      key: (index: number): string | null => [...entries.keys()][index] ?? null,
      removeItem: (key: string): void => void entries.delete(key),
      setItem: (key: string, value: string): void => void entries.set(key, String(value))
    },
    configurable: true
  })
}
