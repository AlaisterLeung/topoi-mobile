/** The two device stores the config layer talks to, faked for the node tests.
 *
 *  Preferences stands in for UserDefaults and the Keychain slot for the native
 *  plugin's one item. Both live on globalThis, because a test that resets the
 *  module registry still has to see the store it seeded before the reset. */

interface DeviceStore {
  preferences: Map<string, string>
  keychain: { value: string | null }
  /** Set to make the next Keychain delete fail the way a locked or full item does. */
  failDelete: boolean
}

const registry = globalThis as typeof globalThis & { __topoiDevice?: DeviceStore }

export const device: DeviceStore = (registry.__topoiDevice ??= {
  preferences: new Map<string, string>(),
  keychain: { value: null },
  failDelete: false
})

export function resetDevice(): void {
  device.preferences.clear()
  device.keychain.value = null
  device.failDelete = false
}

export const Preferences = {
  async get({ key }: { key: string }): Promise<{ value: string | null }> {
    return { value: device.preferences.get(key) ?? null }
  },
  async set({ key, value }: { key: string; value: string }): Promise<void> {
    device.preferences.set(key, value)
  },
  async remove({ key }: { key: string }): Promise<void> {
    device.preferences.delete(key)
  }
}

export const TopoiAuthSession = {
  async start(): Promise<{ url: string }> {
    throw new Error('TopoiAuthSession.start is not stubbed for this test')
  },
  async setTokens({ value }: { value: string }): Promise<void> {
    device.keychain.value = value
  },
  async getTokens(): Promise<{ value: string | null }> {
    return { value: device.keychain.value }
  },
  async clearTokens(): Promise<void> {
    if (device.failDelete) throw new Error('Keychain delete failed (-25300)')
    device.keychain.value = null
  }
}
