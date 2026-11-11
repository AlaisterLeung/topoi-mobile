export interface StartOptions {
  url: string
  redirectPath?: string
  ephemeral?: boolean
}

export interface StartResult {
  url: string
}

/** The Keychain item the plugin owns, as one JSON blob: `null` when the app has
 *  never signed in, or the user signed out. */
export interface TokensResult {
  value: string | null
}

export interface AuthSessionPlugin {
  start(options: StartOptions): Promise<StartResult>
  /** Write the blob into the Keychain, replacing whatever was there. */
  setTokens(options: { value: string }): Promise<void>
  getTokens(): Promise<TokensResult>
  clearTokens(): Promise<void>
}
