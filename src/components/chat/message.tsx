import 'katex/dist/katex.min.css'
import { Streamdown } from 'streamdown'

import { deliveredFiles, kindOfName, parseRow, pathLabel, type RowAttachment } from '../../lib/attachments'
import { markdownControls } from '../../lib/markdown-controls'
import { markdownPlugins } from '../../lib/markdown-plugins'
import { AttachmentRow } from './attachment-row'

export type MessageRole = 'user' | 'assistant'

/** One transcript row. Only the user's turn is a bubble, filled with the accent; an agent turn is plain prose on the page, and both are the transcript's full width. `attachments` is the row as the chat layer already read it; a row without them (a turn still streaming, or a transcript cached before rows carried them) is read here instead. */
export function MessageBubble({
  role,
  text,
  attachments,
  interim
}: {
  role: MessageRole
  text: string
  attachments?: RowAttachment[]
  /** A mid-turn commentary row: painted quiet, because it is not what the turn answered. */
  interim?: boolean
}) {
  if (role === 'user') {
    const row = attachments ? { text, attachments } : parseRow(text)
    // A tool step and an attachment-only turn are both text-less: one earns the
    // dim ellipsis, the other its file rows.
    if (!row.text.trim() && !row.attachments.length) {
      return <p className="px-3 py-1.5 text-base text-zinc-500">…</p>
    }
    return (
      <div data-message="user" className="px-3 py-1.5">
        {row.text.trim() && (
          <div className="md-body bubble-user w-full break-words rounded-2xl bg-primary px-4 py-2 text-base leading-relaxed text-on-primary">
            <Markdown text={row.text} />
          </div>
        )}
        <AttachmentRows attachments={row.attachments} />
      </div>
    )
  }
  const delivered = attachments ? null : deliveredFiles(text)
  const prose = delivered ? delivered.text : text
  const rows =
    attachments ??
    (delivered?.files ?? []).map(file => ({ kind: kindOfName(file), label: pathLabel(file), path: file }))
  if (!prose.trim() && !rows.length) return <p className="px-3 py-1.5 text-base text-zinc-500">…</p>
  return (
    <div data-message="assistant" data-interim={interim ? '' : undefined} className="px-3 py-1.5">
      {prose.trim() && (
        <div className="md-body w-full break-words text-base leading-relaxed">
          <Markdown text={prose} />
        </div>
      )}
      <AttachmentRows attachments={rows} />
    </div>
  )
}

/** The rows under a bubble. Nothing renders when a turn carried nothing. */
function AttachmentRows({ attachments }: { attachments: RowAttachment[] }) {
  if (!attachments.length) return null
  return (
    <div data-attachment-rows className="mt-1 flex max-w-full flex-wrap gap-1.5">
      {attachments.map((attachment, index) => (
        <AttachmentRow key={`${attachment.kind}:${attachment.label}:${index}`} kind={attachment.kind} label={attachment.label} />
      ))}
    </div>
  )
}

/** The prose wrapper is load bearing: Streamdown emits bare HTML, and Tailwind's preflight flattens headings, lists and separators without it. A user turn is a document too, so it takes the same pipeline as an agent turn. */
function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-invert max-w-none">
      <Streamdown controls={markdownControls} plugins={markdownPlugins}>
        {text}
      </Streamdown>
    </div>
  )
}
