import type { ControlsConfig } from 'streamdown'

/** Markdown block controls: a phone has no hover to reveal them with, so no block offers a control. The language row and the table's maximize view stay off with them. */
export const markdownControls: ControlsConfig = {
  code: { copy: false, download: false },
  table: { copy: false, download: false, fullscreen: false }
}
