import { WebPlugin } from '@capacitor/core'

import type { AuthSessionPlugin, StartOptions, StartResult, TokensResult } from './definitions'

/** Nothing here has a browser equivalent: the loopback session is native, and
 *  the Keychain is not reachable from a page. The app's config layer reads a
 *  rejected token call as "signed out", so a browser dev build lands on the
 *  sign-in gate instead of failing to boot. */
export class AuthSessionWeb extends WebPlugin implements AuthSessionPlugin {
  async start(_options: StartOptions): Promise<StartResult> {
    throw this.unimplemented('start is not implemented on web')
  }

  async setTokens(_options: { value: string }): Promise<void> {
    throw this.unimplemented('setTokens is not implemented on web')
  }

  async getTokens(): Promise<TokensResult> {
    throw this.unimplemented('getTokens is not implemented on web')
  }

  async clearTokens(): Promise<void> {
    throw this.unimplemented('clearTokens is not implemented on web')
  }
}
