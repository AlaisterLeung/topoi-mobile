/** Composer attachments: what the picker hands over, what the gateway is asked
 *  to stage, and what a stored row is read back as.
 *
 *  The bytes never sit in a draft: a pending attachment holds the File the
 *  picker produced and is read once, at the send that carries it. */

export type AttachmentKind = 'image' | 'file'

/** One file staged from the picker, before the turn that sends it. */
export interface PendingAttachment {
  id: string
  /** The name the picker gave it, which is the name its row shows. */
  name: string
  kind: AttachmentKind
  size: number
  file: File
}

/** One attachment a stored row names. */
export interface RowAttachment {
  kind: AttachmentKind
  /** The name the row shows: a file path's last segment, or the name a marker carried. */
  label: string
  /** The gateway-side path, when the row named one. */
  path?: string
}

/** What one attachment may weigh, and how many may wait on one send. The
 *  gateway caps an image at 25 MB, but the bytes ride a single WebSocket frame
 *  as base64, so the cap that matters is the one a phone can carry. */
export const MAX_ATTACH_BYTES = 8 * 1024 * 1024
export const MAX_PENDING = 8

/** How many characters an attachment's row may show. The extension is never the
 *  part that gets cut, and the ellipsis supplies the dot it would have carried:
 *  `file20characte...png`. */
const LABEL_LIMIT = 20

export function trimLabel(name: string, limit = LABEL_LIMIT): string {
  const clean = name.trim()
  if (clean.length <= limit) return clean
  const dot = clean.lastIndexOf('.')
  const extension = dot > 0 ? clean.slice(dot + 1) : ''
  const stem = dot > 0 ? clean.slice(0, dot) : clean
  const keep = Math.max(1, limit - extension.length - 3)
  return `${stem.slice(0, keep)}...${extension}`
}

export function attachmentKind(file: File): AttachmentKind {
  return file.type.startsWith('image/') ? 'image' : 'file'
}

/** The image types the gateway's own pipeline accepts. Anything else, an
 *  iPhone's HEIC most often, is re-encoded: the gateway takes the extension
 *  from the bytes and the filename, so a type it does not know would be staged
 *  as a PNG no model can read. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'])

export function needsReencode(file: File): boolean {
  return attachmentKind(file) === 'image' && !IMAGE_TYPES.has(file.type.toLowerCase())
}

/** A picked image the gateway can carry: one outside its list is redrawn as
 *  JPEG, and one the platform cannot decode is handed back untouched, because
 *  the attach is attempted either way and the gateway answers what it thinks. */
export async function normalizeImage(file: File): Promise<File> {
  if (!needsReencode(file)) return file
  try {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const drawn = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!drawn) return file
    return new File([drawn], withJpegExtension(file.name), { type: 'image/jpeg' })
  } catch {
    return file
  }
}

function withJpegExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name}.jpg`
}

/** Stage what the picker returned, refusing the two things the gateway should
 *  not be handed: a file over the cap and one past the per-send limit. Both
 *  come back as a line naming the file that caused it. */
export function addPending(
  current: PendingAttachment[],
  picked: File[]
): { pending: PendingAttachment[]; errors: string[] } {
  const pending = current.slice()
  const errors: string[] = []
  for (const file of picked) {
    if (file.size > MAX_ATTACH_BYTES) {
      errors.push(`${trimLabel(file.name)} is over ${Math.round(MAX_ATTACH_BYTES / 1024 / 1024)} MB`)
      continue
    }
    if (pending.length >= MAX_PENDING) {
      errors.push(`Only ${MAX_PENDING} attachments can wait on one message`)
      break
    }
    pending.push({
      id: `${file.name}:${file.size}:${file.lastModified}:${pending.length}`,
      name: file.name || 'attachment',
      kind: attachmentKind(file),
      size: file.size,
      file
    })
  }
  return { pending, errors }
}

export function removePending(current: PendingAttachment[], id: string): PendingAttachment[] {
  return current.filter(attachment => attachment.id !== id)
}

/** One attachment's bytes as a data URL. Both attach calls take the bytes in
 *  band, and the gateway decodes either a data URL or bare base64. */
export function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error(`Could not read ${file.name}`))
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error(`Could not read ${file.name}`)))
    reader.readAsDataURL(file)
  })
}

/** The base64 half of a data URL. */
export function base64Of(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : ''
}

/** What one image attach answers. */
export interface AttachImageReply {
  attached: boolean
  name?: string
  path?: string
  text?: string
  message?: string
}

/** What one file attach answers: `ref_text` is the `@file:` ref the submitted
 *  prompt has to carry for the agent to read the file. */
export interface AttachFileReply {
  attached: boolean
  ref_text?: string
  message?: string
}

/** The two gateway calls an attachment is staged through. A picture goes to the
 *  session's image queue, which the next turn reads as pixels; anything else is
 *  staged into the session's own attachments directory and named by a ref. */
export interface AttachTarget {
  attachImageBytes(
    sessionId: string,
    payload: { contentBase64: string; filename: string }
  ): Promise<AttachImageReply>
  attachFile(sessionId: string, payload: { name: string; dataUrl: string }): Promise<AttachFileReply>
}

/** One staged attachment, as the gateway answered it. */
export interface AttachedResult {
  attachment: PendingAttachment
  /** The gateway-side path, when it named one. */
  path?: string
  /** The `@file:` ref a non-image has to be submitted with. */
  ref?: string
}

/** Stage every attachment a send carries, in the order they were picked. Each
 *  one is its own frame holding the whole file, so they go one at a time, and a
 *  refusal stops the send rather than dropping an attachment silently. */
export async function attachAll(
  target: AttachTarget,
  sessionId: string,
  attachments: PendingAttachment[]
): Promise<AttachedResult[]> {
  const staged: AttachedResult[] = []
  for (const attachment of attachments) {
    const dataUrl = await toDataUrl(attachment.file)
    if (attachment.kind === 'image') {
      const reply = await target.attachImageBytes(sessionId, {
        contentBase64: base64Of(dataUrl),
        filename: attachment.name
      })
      if (!reply.attached) throw new Error(reply.message || `Could not attach ${attachment.name}`)
      staged.push({ attachment, path: reply.path })
      continue
    }
    const reply = await target.attachFile(sessionId, { name: attachment.name, dataUrl })
    if (!reply.attached || !reply.ref_text) throw new Error(reply.message || `Could not attach ${attachment.name}`)
    staged.push({ attachment, path: reply.ref_text.replace(/^@file:/, ''), ref: reply.ref_text })
  }
  return staged
}

/** The line the submitted prompt carries for one attachment. A file's line is
 *  the gateway's own ref, which is what the agent reads it from. An image's is a
 *  note: the pixels ride the session's image queue, and the note is what the
 *  transcript reads back into a row when the thread is reloaded. */
export function attachmentLine(result: AttachedResult): string {
  if (result.ref) return result.ref
  return `[User attached image: ${result.attachment.name}]`
}

/** The prompt one send submits: the refs and notes first, then what was typed.
 *  An attachments-only send still carries the note its attachment was staged
 *  with, which is the same line the terminal's own drop path submits. */
export function composeSubmit(results: AttachedResult[], text: string): string {
  const lines = results.map(attachmentLine).filter(Boolean).join('\n')
  return [lines, text.trim()].filter(Boolean).join('\n\n')
}

/** The extensions that read as a picture when all a row has is a name: an
 *  agent's `MEDIA:` line names a file, and a chart it delivered should still
 *  show the icon its kind earns. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic'])

export function kindOfName(name: string): AttachmentKind {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'file'
  return IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase()) ? 'image' : 'file'
}

const IMAGE_MARKER = /^\[User attached image: (.+?)\]$/
const FILE_MARKER = /^\[User attached file: (.+?)\]$/
/** The note the gateway writes for a rasterized PDF: `brief.pdf (3 page(s))`. */
const PDF_MARKER = /^\[User attached PDF: (.+?)(?: \(\d+ page\(s\)\))?\]$/
/** The ref line a send of this app carries for a file: the client's own, and the
 *  only one painted. */
const REF_LINE = /^@file:(.+)$/

/** The gateway's own ref for an image it staged, stamped onto the stored row
 *  after the text. The client already names that picture with its own marker,
 *  so painting this line would show every image twice. */
const CORE_IMAGE_REF = /^@image:.+$/

/** What the gateway writes in place of an image it routes natively, and the
 *  placeholder its text-only projection leaves behind once the pixels are out. */
const CORE_ATTACHED_AT = /^\[Image attached at: .+\]$/
const CORE_PLACEHOLDER = /^\[(?:screenshot|image|attachment|file)\]$/i

/** The recalled-memory block the gateway appends to a stored prompt: never the
 *  user's own words, and nothing a bubble should paint. */
const MEMORY_CONTEXT = /<memory-context>[\s\S]*?(?:<\/memory-context>|$)/i

/** The text a row is read as once the gateway's own lines are out of it. This is
 *  what a bubble paints and what a resume compares: the stored row and the
 *  optimistic one carry different markers for the same turn, and comparing the
 *  raw text is exactly what paints that turn twice. */
export function rowText(text: string): string {
  return parseRow(text).text
}

/** A ref value the gateway quoted, unwrapped: a path with a space in it is
 *  written `@file:"/a/b c.pdf"`. */
function unquote(value: string): string {
  const trimmed = value.trim()
  const wrapped =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('`') && trimmed.endsWith('`'))
  return wrapped ? trimmed.slice(1, -1) : trimmed
}

/** The last segment of a path, which is the name a row shows. */
export function pathLabel(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
}

/** What a stored user row holds besides its prose: the attach notes the gateway
 *  wrote and the refs the send carried, lifted out of the text so the bubble
 *  paints only what was typed and the rows paint the attachments. */
export function parseRow(text: string): { attachments: RowAttachment[]; text: string } {
  const attachments: RowAttachment[] = []
  const kept: string[] = []
  for (const line of text.replace(MEMORY_CONTEXT, '').split('\n')) {
    const trimmed = line.trim()
    // The gateway's own attachment lines are not the client's: it named these
    // files when it sent them, so these are dropped rather than painted twice.
    if (CORE_IMAGE_REF.test(trimmed) || CORE_ATTACHED_AT.test(trimmed) || CORE_PLACEHOLDER.test(trimmed)) continue
    const image = IMAGE_MARKER.exec(trimmed)
    const file = FILE_MARKER.exec(trimmed)
    const pdf = PDF_MARKER.exec(trimmed)
    const ref = REF_LINE.exec(trimmed)
    if (image) {
      attachments.push({ kind: 'image', label: unquote(image[1] ?? '') })
      continue
    }
    if (file) {
      const path = unquote(file[1] ?? '')
      attachments.push({ kind: 'file', label: pathLabel(path), path })
      continue
    }
    if (pdf) {
      const path = unquote(pdf[1] ?? '')
      attachments.push({ kind: 'file', label: pathLabel(path), path })
      continue
    }
    if (ref) {
      const path = unquote(ref[1] ?? '')
      attachments.push({ kind: 'file', label: pathLabel(path), path })
      continue
    }
    kept.push(line)
  }
  return { attachments, text: kept.join('\n').trim() }
}

const MEDIA_LINE = /^[\t ]*MEDIA:[\t ]*(.+?)[\t ]*$/

/** The files an agent turn delivered, and the prose that is left once their
 *  `MEDIA:` lines are lifted out: the desktop paints these as cards below the
 *  answer, so the mobile transcript paints them as rows there too. */
export function deliveredFiles(text: string): { files: string[]; text: string } {
  const files: string[] = []
  const kept: string[] = []
  for (const line of text.split('\n')) {
    const media = MEDIA_LINE.exec(line)
    if (!media) {
      kept.push(line)
      continue
    }
    files.push(unquote(media[1] ?? ''))
  }
  return { files, text: kept.join('\n').trim() }
}
