import { FileText, Image as ImageIcon, X } from 'lucide-react'

import { trimLabel, type AttachmentKind } from '../../lib/attachments'

/** One attachment's row: the icon of its kind, its name with the extension kept
 *  whole, and, while it is still waiting on a send, the cross that takes it back
 *  off.
 *
 *  A row that was sent carries no cross and no download button: saving a
 *  delivered file onto the phone is the next increment, and a button that did
 *  nothing would read as a bug. */
export function AttachmentRow({
  kind,
  label,
  onRemove
}: {
  kind: AttachmentKind
  label: string
  onRemove?: () => void
}) {
  const Icon = kind === 'image' ? ImageIcon : FileText
  const text = trimLabel(label)
  return (
    <div
      data-attachment-row
      className="flex max-w-full items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
      <span className="min-w-0 truncate text-sm">{text}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${text}`}
          className="-mr-0.5 shrink-0 p-0.5 text-zinc-400 active:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
