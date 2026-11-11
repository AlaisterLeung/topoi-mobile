import { useState } from 'react'

import { ChevronLeft } from 'lucide-react'

import { loadBaseUrl } from '../lib/config'

/** The two repos behind the app, and the one it is pointed at. */
const REPOS = [
  { name: 'AlaisterLeung/topoi', url: 'https://github.com/AlaisterLeung/topoi' },
  { name: 'AlaisterLeung/topoi-mobile', url: 'https://github.com/AlaisterLeung/topoi-mobile' }
]

const AUTHOR = { name: 'Alaister LJ Leung', url: 'https://github.com/AlaisterLeung' }

/** The settings screen: the gateway this app is pointed at, the cached data it
 *  can drop, the way out of the session, and what this build is. It reads
 *  nothing from the gateway, so it draws on its own state alone. */
export function Settings({
  onBack,
  onClearCache,
  onSignOut
}: {
  onBack: () => void
  onClearCache: () => void
  onSignOut: () => void
}) {
  const [baseUrl] = useState(loadBaseUrl)

  /** Both prompts are the platform's own: Capacitor's `WKUIDelegate` implements
   *  the JS panels, so `window.confirm` is a UIAlertController with Cancel and Ok
   *  and `window.alert` one with a single Ok, and neither needs a plugin. The
   *  cache is dropped only on an accepted confirm, and the alert reports it. */
  function confirmClearCache() {
    if (!window.confirm('Do you want to clear app cache?')) return
    onClearCache()
    window.alert('App cache is cleared.')
  }

  /** The prompt is the platform's own: WKWebView hands window.confirm to
   *  Capacitor's WKUIDelegate, which presents a UIAlertController with Cancel
   *  and Ok, so the confirmation is native without a plugin. */
  function confirmSignOut() {
    if (window.confirm('Sign out of Topoi?')) onSignOut()
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-white/10 px-2 py-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to topics"
          className="p-1.5 text-zinc-300 active:text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-base font-medium">Settings</span>
      </header>
      <div className="safe-b h-full overflow-y-auto">
        <section className="border-b border-white/10 px-4 py-4">
          <h2 className="text-base uppercase tracking-wide text-zinc-500">Gateway</h2>
          <label className="mt-3 block text-xs text-zinc-400" htmlFor="dashboard-url">
            Hermes Dashboard URL
          </label>
          <input
            id="dashboard-url"
            readOnly
            value={baseUrl}
            className="mt-1.5 w-full rounded-xl bg-white/5 px-3 py-2.5 text-base text-zinc-300 outline-none"
          />
          <button
            type="button"
            onClick={confirmSignOut}
            className="mt-4 w-full rounded-xl py-2.5 text-base font-medium active:opacity-60"
          >
            Sign Out
          </button>
          <button
            type="button"
            onClick={confirmClearCache}
            className="mt-2 w-full rounded-xl py-2.5 text-base font-medium text-red-400 active:bg-red-500/10"
          >
            Clear Cache
          </button>
        </section>
        <section className="px-4 py-4">
          <h2 className="text-base uppercase tracking-wide text-zinc-500">About Topoi</h2>
          <p className="mt-3 text-base">Topoi Mobile v{__APP_VERSION__}</p>
          <div className="mt-3 flex flex-col gap-2">
            {REPOS.map(repo => (
              <a
                key={repo.url}
                href={repo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary underline-offset-2 active:underline"
              >
                {repo.name}
              </a>
            ))}
          </div>
          <p className="mt-4 text-sm text-zinc-500">
            by{' '}
            <a
              href={AUTHOR.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-2 active:underline"
            >
              {AUTHOR.name}
            </a>
          </p>
        </section>
      </div>
    </div>
  )
}
