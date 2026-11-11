import type { PendingAttachment } from '../../lib/attachments'
import { AttachmentRow } from './attachment-row'

/** What is waiting to be sent, as rows above the composer: one row per file,
 *  wrapping onto the next line rather than scrolling, each with the cross that
 *  takes it back off. Nothing renders when nothing is staged. */
export function AttachmentBar({
  attachments,
  onRemove
}: {
  attachments: PendingAttachment[]
  onRemove: (id: string) => void
}) {
  if (!attachments.length) return null
  return (
    <div data-attachments className="flex max-w-full flex-wrap gap-1.5 pb-1">
      {attachments.map(attachment => (
        <AttachmentRow
          key={attachment.id}
          kind={attachment.kind}
          label={attachment.name}
          onRemove={() => onRemove(attachment.id)}
        />
      ))}
    </div>
  )
}
