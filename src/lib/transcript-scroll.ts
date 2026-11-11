/** How close to the bottom the view still counts as following: a reader inside
 *  this band is on the newest row, so new rows and streamed deltas keep landing
 *  under them. */
export const FOLLOW_PX = 24

/** Where a transcript's reader sits: `follow` says the view is at the bottom and
 *  moves with the conversation, `top` is the place it is reading while it does
 *  not. */
export interface Reader {
  follow: boolean
  top: number
}

/** A chat opens on its newest row. */
export const AT_BOTTOM: Reader = { follow: true, top: 0 }

/** The reader after a scroll, the user's or one the screen made itself. */
export function readScroll(scrollHeight: number, scrollTop: number, clientHeight: number): Reader {
  const top = Math.max(0, scrollTop)
  return { follow: scrollHeight - top - clientHeight <= FOLLOW_PX, top }
}

/** Where a repaint puts the view: a following reader lands on the newest row, any
 *  other keeps the place it was reading. Every repaint of the SAME conversation
 *  goes through here - a resume after the app came back, a reconnect, a refresh -
 *  and none of them may move a reader who scrolled back. */
export function repaintTop(reader: Reader, scrollHeight: number): number {
  return reader.follow ? scrollHeight : Math.min(reader.top, scrollHeight)
}
