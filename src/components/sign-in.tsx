import { useState } from 'react'

import { signIn } from '../lib/auth'
import { loadBaseUrl, normalizeBaseUrl, saveBaseUrl } from '../lib/config'

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [baseUrl, setBaseUrl] = useState(loadBaseUrl())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignIn() {
    setBusy(true)
    setError(null)
    try {
      const url = normalizeBaseUrl(baseUrl)
      await saveBaseUrl(url)
      await signIn(url)
      onSignedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Topoi</h1>
        <p className="mt-1 text-sm text-zinc-500">Sign in to your Hermes Gateway</p>
      </div>
      <div className="w-full max-w-sm space-y-3">
        <label className="block text-xs text-zinc-400" htmlFor="base-url">
          Hermes Dashboard URL
        </label>
        <input
          id="base-url"
          value={baseUrl}
          onChange={event => setBaseUrl(event.target.value)}
          className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-base outline-none focus:ring-1 focus:ring-primary"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={handleSignIn}
          disabled={busy || !baseUrl.trim()}
          className="w-full rounded-xl bg-primary py-2.5 text-base font-medium text-on-primary disabled:opacity-40"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  )
}
