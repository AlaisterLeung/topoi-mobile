/** The message of an unknown throw, for a UI line. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
