import { readFileSync } from 'node:fs'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** The app's version, read from package.json so the About row names the build
 *  the user is running; scripts/sync-version.mjs mirrors the same value into the
 *  iOS bundle's MARKETING_VERSION. */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Fixed port for Capacitor live reload: a silent move to 5174 points the app at nothing.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  // Keep the dev dep scanner on the app entry: walking vendor/hermes-agent hits its eval fixtures.
  optimizeDeps: { entries: ['index.html'] }
})
