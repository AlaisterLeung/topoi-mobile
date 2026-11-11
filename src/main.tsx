import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { hydrateConfig } from './lib/config'
import { pinKeyboardLayout, pinVisibleViewport } from './lib/keyboard'
import './styles.css'

/** The stores are read before the first render: the sign-in gate and the link both decide from them, and a render that beat the read would paint a signed-out app over a session that exists. The boot splash in index.html stays up for the few milliseconds it takes. The keyboard's layout mode is set beside it but not awaited: a native call must never hold up the first paint. */
async function boot(): Promise<void> {
  await hydrateConfig()
  void pinKeyboardLayout()
  pinVisibleViewport()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void boot()
