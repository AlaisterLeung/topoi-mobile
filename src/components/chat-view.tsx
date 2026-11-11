import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { AssistantRuntimeProvider, ComposerPrimitive, useExternalStoreRuntime } from '@assistant-ui/react'
import { ArrowUp, ChevronLeft, Plus, RefreshCw, Square } from 'lucide-react'
import type { GatewayEvent, MessageCompletePayload, StreamDeltaPayload } from '@topoi/core'

import {
  addPending,
  attachAll,
  composeSubmit,
  normalizeImage,
  removePending,
  type PendingAttachment
} from '../lib/attachments'
import {
  applyDelta,
  applyFinal,
  applyHeld,
  collapseToolSteps,
  hideCronDelivery,
  markInterim,
  paintedRow,
  STEER_KIND,
  toThreadMessages,
  transcriptToMessages,
  type ChatMessage,
  type HeldEvent
} from '../lib/chat'
import { draftKeys, dropDraft, moveDraft, readDraft, writeDraft } from '../lib/drafts'
import { messageOf } from '../lib/errors'
import { gateway } from '../lib/gateway'
import { idSet, rebuildTranscript, resumeTranscript } from '../lib/resume'
import { cacheKeys, dropCache, tailOf, writeCache } from '../lib/screen-cache'
import { fileThread, type TopicEntry } from '../lib/topics'
import { AT_BOTTOM, readScroll, repaintTop, type Reader } from '../lib/transcript-scroll'
import { AttachmentBar } from './chat/attachment-bar'
import { ComposerDraftSync } from './chat/draft-sync'
import { LoadingOverlay } from './loading-overlay'
import { loadModelOptions, loadReasoningEffort, pickModel, pickReasoningEffort } from '../lib/model-choice'
import { modelLabel, reasoningLabel } from '../lib/model-catalog'
import { ModelSheet } from './chat/model-sheet'
import { ReasoningSheet } from './chat/reasoning-sheet'
import { MessageBubble } from './chat/message'

/** How many frames a following reader is re-pinned for after a repaint: the
 *  markdown under a streamed row lays itself out a frame or two after the commit,
 *  and the bottom it scrolled to is no longer the bottom by then. */
const PIN_FRAMES = 6

/** How long ONE cold rebuild may take in total, across every id it asks. A resume that
 *  never answers must not hold the transcript hostage: the rows behind the pane are
 *  frozen and every delta the live turn streams is held until it settles, so the budget
 *  is short, and the failure path replays what was held onto the rows still on screen. */
const REBUILD_WAIT_MS = 12_000

/** `work`, or a rejection after `ms`. The timer is cleared as soon as the work
 *  settles, so a fast answer leaves nothing pending behind it. */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the gateway did not answer')), ms)
    work.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export function ChatView({
  sessionId,
  storedSessionId,
  initialMessages,
  title,
  topic,
  newThread,
  hideDelivery,
  onBack
}: {
  sessionId: string
  storedSessionId?: string
  /** The transcript cached for this thread, or null when none is stored: null
   *  is what raises the load pane, because there is nothing truthful to show. */
  initialMessages: ChatMessage[] | null
  title: string
  /** The topic this chat was opened from: its back button returns there. */
  topic?: TopicEntry
  /** Set when the plus button minted this chat: its first accepted prompt
   *  files the thread under the topic, waiting out the row write. */
  newThread?: boolean
  /** Set for a reply into a scheduled run's seeded thread: its opening row is the
   *  delivery the reader already shows, so it is not painted as a prompt. */
  hideDelivery?: boolean
  onBack: () => void
}) {
  /** The surface this composer's draft belongs to. A new thread is named by its
   *  topic, because the plus button mints a fresh session on every press and the
   *  draft has to survive all of them; a thread is named by the id that survives
   *  a gateway restart. */
  const surface = useMemo(
    () => (newThread && topic ? draftKeys.newThread(topic.id) : draftKeys.thread(storedSessionId || sessionId)),
    [newThread, sessionId, storedSessionId, topic]
  )
  const [draftSurface, setDraftSurface] = useState(surface)
  const [draftText, setDraftText] = useState(() => readDraft(surface)?.text ?? '')
  const [pending, setPending] = useState<PendingAttachment[]>(() => readDraft(surface)?.attachments ?? [])
  /** Counts accepted sends. The composer clears itself when one lands, but that
   *  clear is not guaranteed to reach this screen before the draft is written
   *  back, so the clear is asked for explicitly as well. */
  const [sent, setSent] = useState(0)
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? [])
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Which composer sheet is up, if any. */
  const [sheet, setSheet] = useState<'model' | 'reasoning' | null>(null)
  /** The model and effort this chat runs on, as the two chips read them: seeded
   *  from the gateway, then owned by the picks. */
  const [composerModel, setComposerModel] = useState({ provider: '', model: '' })
  const [effort, setEffort] = useState('')
  /** A chat opened without a cached transcript covers itself until the resume
   *  answers; one opened from the cache draws its rows at once and resumes
   *  behind them. */
  const [loading, setLoading] = useState(initialMessages === null && !newThread)
  /** True until this chat's first resume answers: a refresh tapped inside that
   *  window is a no-op, because the fetch already in flight owns the rows. */
  const [fetching, setFetching] = useState(!newThread)
  const [refreshing, setRefreshing] = useState(false)
  /** The ids naming this chat: the gateway tags events with the RUNTIME session
   *  id, while a listed chat is keyed by its stored id, and a gateway restart
   *  mints a new runtime id, so both move together here. */
  const [ids, setIds] = useState<string[]>(() => idSet(sessionId, storedSessionId))
  /** The transcript is cached under the stored id, the one name that still
   *  resolves after a restart. */
  const cacheId = storedSessionId || sessionId
  const idsRef = useRef(ids)
  const messagesRef = useRef(messages)
  /** Whether a turn is streaming, readable from inside a callback: `submit` is
   *  not rebuilt mid-turn, so the state it closed over would be stale. */
  const runningRef = useRef(isRunning)
  const pickerRef = useRef<HTMLInputElement>(null)
  const filed = useRef(false)
  const dropped = useRef(false)
  const started = useRef(false)
  /** True once a resume has answered a runtime id: until then the stored id is
   *  the only name this chat has, and prompt.submit refuses it. */
  const resolved = useRef(Boolean(newThread))
  /** The first transcript load, so a send made while it runs waits for the
   *  runtime id instead of failing against the stored one. */
  const opening = useRef<Promise<boolean> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** Where the transcript's reader sits: at the bottom it follows the
   *  conversation, anywhere else it keeps the place it is reading. Never held in
   *  state - it moves on every scroll frame, and a repaint far more often than
   *  the screen navigates. */
  const reader = useRef<Reader>(AT_BOTTOM)
  /** The last place this screen itself put the view. The scroll event that write
   *  fires is not the reader moving, so it must not be read as one: that is what
   *  used to unpin a reader who was watching a turn stream in. */
  const wrote = useRef<number | null>(null)
  const trackScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    if (wrote.current !== null && Math.abs(element.scrollTop - wrote.current) <= 1) {
      // Our own write landing: following and reading stay exactly as they were.
      reader.current = { ...reader.current, top: element.scrollTop }
      return
    }
    reader.current = readScroll(element.scrollHeight, element.scrollTop, element.clientHeight)
  }, [])
  /** Follow again: only a send does this without the reader already being at the
   *  bottom, because that turn is the one they are about to read. */
  const follow = useCallback(() => {
    reader.current = { follow: true, top: reader.current.top }
  }, [])

  useEffect(() => {
    idsRef.current = ids
    messagesRef.current = messages
    runningRef.current = isRunning
  })

  /** Keep the surface's draft current: switching threads and pressing plus again
   *  both come back to whatever was typed and staged, and an empty draft leaves
   *  nothing behind for the next open to raise. */
  useEffect(() => {
    writeDraft(draftSurface, { text: draftText, attachments: pending })
  }, [draftSurface, draftText, pending])

  /** An event that lands while a cold rebuild is fetching. The rebuilt transcript
   *  is the gateway's answer as of the moment it replied, so anything that
   *  arrived after it is replayed onto the result; applied to the rows the
   *  rebuild replaces, they would be lost. */
  const held = useRef<HeldEvent[] | null>(null)
  /** The cold rebuild in flight, so a warm resume that arrives beside it waits for
   *  its answer instead of committing older rows over it. */
  const rebuilding = useRef<Promise<boolean> | null>(null)
  /** The one-shot re-sync that heals a settle-window row, cleared on the way out. */
  const settleTimer = useRef<number | null>(null)

  /** Rebuild this chat from the gateway: the transcript moves and a restarted
   *  gateway has minted a new runtime id, so the stored id is asked first and
   *  the id the chat was opened with is the fallback. A COLD sync is the tapped
   *  refresh: the gateway's transcript is the whole answer and the screen's own
   *  tail is not merged back into it, which is what kept a stray bubble alive
   *  through every refresh. Only the prompt sent a moment ago is carried. */
  const sync = useCallback(
    async (cold = false): Promise<boolean> => {
      // A cold rebuild already owns the transcript. A warm resume STARTING now
      // would mutate messagesRef against it, so it waits instead. One already in
      // flight is not cancelled and cannot resurrect a stray row: what it merges
      // is the rebuilt transcript, which no longer carries one.
      if (!cold && rebuilding.current) return rebuilding.current
      if (cold) held.current = []
      const until = cold ? Date.now() + REBUILD_WAIT_MS : Number.POSITIVE_INFINITY
      const candidates = idSet(storedSessionId, idsRef.current[0])
      for (const id of candidates) {
        try {
          const resume = cold
            ? await withDeadline(gateway.resume(id), Math.max(until - Date.now(), 1_000))
            : await gateway.resume(id)
          const runtime = resume.session_id || id
          const stored = transcriptToMessages(resume.messages)
          let next = cold ? rebuildTranscript(stored, messagesRef.current, resume) : resumeTranscript(stored, messagesRef.current, resume)
          // What arrived while this fetch was out, replayed in arrival order on
          // top of the transcript the fetch answers.
          const waited = cold ? (held.current ?? []) : []
          // A cold rebuild took over while this warm resume was out: its result is
          // the one that lands, so this older answer is dropped whole.
          if (!cold && held.current) return rebuilding.current ?? true
          for (const event of waited) next = applyHeld(next, event)
          if (cold) held.current = null
          idsRef.current = idSet(runtime, storedSessionId)
          setIds(idsRef.current)
          messagesRef.current = next
          setMessages(next)
          writeCache(cacheKeys.messages(cacheId), tailOf(next))
          // A final that landed mid-fetch already ended the turn, whatever the
          // snapshot says: the stop button must not come back. A prompt sent during
          // the fetch is a turn of its own, so it keeps the turn running.
          setIsRunning(
            waited.some(event => event.local)
              ? true
              : !waited.some(event => event.final !== undefined) && Boolean(resume.running)
          )
          setError(null)
          resolved.current = true
          return true
        } catch {
          // Try the next id: after a restart only the stored one still resolves.
        }
      }
      // Nothing resolved (or the gateway never answered), so the rebuild never
      // landed: what it held goes onto the rows still on screen instead of being
      // dropped.
      const keptEvents = held.current
      held.current = null
      if (cold && keptEvents?.length) {
        let next = messagesRef.current
        for (const event of keptEvents) next = applyHeld(next, event)
        messagesRef.current = next
        setMessages(next)
      }
      return false
    },
    [cacheId, storedSessionId]
  )

  useEffect(() => {
    return gateway.onEvent((event: GatewayEvent) => {
      if (!event.session_id || !ids.includes(event.session_id)) return
      if (event.type === 'message.start') {
        setIsRunning(true)
      } else if (event.type === 'message.delta') {
        const payload = event.payload as StreamDeltaPayload
        setIsRunning(true)
        // A cold rebuild owns the rows until it commits: this text belongs on
        // top of its result, not on the array it is about to replace.
        if (held.current) {
          held.current.push({ delta: payload })
          return
        }
        setMessages(prev => applyDelta(prev, payload))
      } else if (event.type === 'message.complete') {
        const payload = event.payload as MessageCompletePayload
        const finalText = typeof payload.text === 'string' ? payload.text : null
        setIsRunning(false)
        if (held.current) {
          held.current.push({ final: finalText })
          return
        }
        setMessages(prev => applyFinal(prev, finalText))
      }
    })
  }, [ids])

  /** The view after a repaint: a following reader lands on the newest row, and
   *  one that scrolled back keeps the place it was reading. Every repaint of the
   *  SAME conversation lands here - the first resume, a re-sync after the app came
   *  back, a reconnect after the socket died in the background, a refresh - and
   *  none of them may move the reader. This is why coming back from another app
   *  no longer jumps to the bottom. A following reader is then put back on the
   *  bottom for a few frames, because the row that just painted can grow a frame
   *  or two later: streamdown renders its markdown (and its code blocks) after the
   *  commit, and a reader watching a turn stream in would otherwise drift above
   *  the newest line. Bounded, because the next delta supersedes this run. */
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const following = reader.current.follow
    element.scrollTop = repaintTop(reader.current, element.scrollHeight)
    wrote.current = element.scrollTop
    if (!following) return
    let frame = 0
    let ticks = 0
    const settle = () => {
      const later = scrollRef.current
      // A finger that scrolled back during these frames owns the view now.
      if (!later || !reader.current.follow) return
      if (later.scrollHeight - later.scrollTop - later.clientHeight > 1) {
        later.scrollTop = later.scrollHeight
        wrote.current = later.scrollTop
      }
      if (ticks++ < PIN_FRAMES) frame = requestAnimationFrame(settle)
    }
    frame = requestAnimationFrame(settle)
    return () => cancelAnimationFrame(frame)
  }, [messages])

  /** Load the transcript once, on mount. A new thread has none to load: the
   *  gateway mints its row with the first prompt. */
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (newThread) return
    opening.current = (async () => {
      const ok = await sync()
      if (!ok) setError('Could not load this thread')
      setLoading(false)
      setFetching(false)
      return ok
    })()
  }, [newThread, sync])

  useEffect(() => {
    return gateway.onState(state => {
      if (state === 'open') {
        if (!dropped.current) return
        dropped.current = false
        void sync().then(ok => {
          if (!ok) setError('Could not re-sync this thread after reconnecting')
        })
        return
      }
      dropped.current = true
    })
  }, [sync])

  /** Refresh: an authoritative rebuild of this thread. The cache is dropped (it
   *  is only a copy of what the gateway holds) and the resume is taken as the
   *  whole answer, so a row the gateway never wrote cannot survive the tap - the
   *  warm merge would carry exactly that row forward again. Nothing is asked
   *  first, and a tap while the first fetch is still out does nothing. The rows
   *  it already has stay painted under the pane: emptying them would collapse
   *  the scroller and lose the place the reader was at, and the pane covers them
   *  anyway. */
  const refresh = useCallback(async () => {
    // The state guard below is a render behind a second tap inside one frame; the ref
    // is synchronous, and a second cold rebuild would reset `held` under the first.
    if (rebuilding.current) return
    if (fetching || refreshing) return
    setRefreshing(true)
    setError(null)
    dropCache(cacheKeys.messages(cacheId))
    setLoading(true)
    // Nothing is lost by a tap whose newest row is a prompt: the rebuild keeps the
    // trailing run of prompts. What can be lost is a settled answer, so the heal below
    // arms only when the rebuild left that answer unaccounted for (`lost`).
    const tail = messagesRef.current[messagesRef.current.length - 1]
    const run = sync(true)
    rebuilding.current = run
    try {
      if (!(await run)) setError('Could not refresh this thread')
    } finally {
      if (rebuilding.current === run) rebuilding.current = null
      setLoading(false)
      setRefreshing(false)
    }
    // One shot, a moment later: the authoritative read above drops an answer the
    // gateway had not written yet (the settle window), so this second, warm resume
    // reads it back. It schedules nothing, so it can never loop, and a tap with no
    // answer on screen arms nothing at all.
    // Arm the heal only if the rebuild really lost that answer: the stray copy of a
    // stored answer matches it by prefix, so nothing was lost and no second fetch is
    // worth spending. Only the settle window leaves a row unaccounted for.
    const lost = tail?.role === 'assistant' && !messagesRef.current.some(row => {
      if (row.role !== 'assistant') return false
      const one = row.text.trim()
      const other = tail.text.trim()
      return one === other || one.startsWith(other) || other.startsWith(one)
    })
    if (!lost) return
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null
      if (!rebuilding.current) void sync()
    }, 1_200)
  }, [cacheId, fetching, refreshing, sync])

  /** Keep the cached transcript current: a settled turn and the way out of the
   *  screen both write what is on it, so the next open draws it at once. */
  useEffect(() => {
    if (isRunning) return
    writeCache(cacheKeys.messages(cacheId), tailOf(messagesRef.current))
  }, [cacheId, isRunning])

  useEffect(() => {
    return () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
      writeCache(cacheKeys.messages(cacheId), tailOf(messagesRef.current))
    }
  }, [cacheId])

  const onText = useCallback((text: string) => setDraftText(text), [])

  /** What the picker handed back. An image the gateway cannot carry as it stands
   *  is redrawn first, and the picker is emptied so the same file can be picked
   *  twice in a row (a live input does not fire a second change for it). */
  async function pickAttachments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    const normalized = await Promise.all(files.map(file => normalizeImage(file)))
    const { pending: next, errors } = addPending(pending, normalized)
    setPending(next)
    if (errors.length) setError(errors.join('\n'))
  }

  /** The id a prompt is submitted under. The gateway only accepts the runtime
   *  id, so a send waits out the resume that answers it, and loads the thread
   *  itself when the first attempt did not land. */
  const liveId = useCallback(async (): Promise<string> => {
    if (opening.current) await opening.current
    if (resolved.current) return idsRef.current[0]
    const ok = await sync()
    if (!ok) throw new Error('This thread is not connected')
    return idsRef.current[0]
  }, [sync])

  /** The chips' reads: both go through the live id, so they answer with THIS
   *  chat's model and effort rather than the profile default, and a pick made
   *  before this chat has a runtime id still lands on the right session. */
  const loadModels = useCallback(() => liveId().then(id => loadModelOptions(id)), [liveId])
  const loadEffort = useCallback(() => liveId().then(id => loadReasoningEffort(id)), [liveId])
  /** The reads live in refs: their identity rides `liveId`, which rides `sync`,
   *  and a `model.options` payload re-read per streamed delta is a silent RPC
   *  storm. The session id is what decides a new pass. */
  const seedLoad = useRef({ models: loadModels, effort: loadEffort })
  seedLoad.current = { models: loadModels, effort: loadEffort }

  /** One pass per chat: the chips forget the thread they were reading, then
   *  seed from the gateway. Both reads ride the live id, so they answer with
   *  THIS chat's model and effort. */
  useEffect(() => {
    let live = true
    setComposerModel({ provider: '', model: '' })
    setEffort('')
    setSheet(null)
    seedLoad.current.models().then(
      answer => {
        if (!live) return
        setComposerModel(current =>
          current.model ? current : { provider: answer.provider || '', model: answer.model || '' }
        )
      },
      () => {}
    )
    seedLoad.current.effort().then(
      value => {
        if (live) setEffort(current => current || value)
      },
      () => {}
    )
    return () => {
      live = false
    }
  }, [sessionId])

  /** A pick paints at once and rolls back when the gateway refuses it (or asks to
   *  confirm an expensive model and the user says no). */
  const applyModel = useCallback(
    (provider: string, model: string) => {
      const previous = composerModel
      setComposerModel({ provider, model })
      void liveId()
        .then(id => pickModel(id, provider, model))
        .then(
          applied => {
            if (!applied) setComposerModel(previous)
          },
          error => {
            setComposerModel(previous)
            setError(messageOf(error))
          }
        )
    },
    [composerModel, liveId]
  )

  const applyEffort = useCallback(
    (value: string) => liveId().then(id => pickReasoningEffort(id, value)),
    [liveId]
  )

  /** One send, from the Send button: the composer does not submit on Enter,
   *  so the button is the only entry, and it is what carries an
   *  attachments-only message (the composer counts only its own text as
   *  something to send, and a staged file lives outside it). */
  const submit = useCallback(
    async (text: string) => {
      const attachments = pending
      if (!text.trim() && !attachments.length) return
      setError(null)
      try {
        const id = await liveId()
        // Staging comes first: a file reaches the agent through the ref the
        // gateway answers with, and the bubble this prompt paints has to carry
        // exactly the text the gateway is handed, or the next resume paints the
        // same turn a second time.
        const staged = await attachAll(gateway, id, attachments)
        const composed = composeSubmit(staged, text)
        // A send lands on the newest row even when the reader had scrolled back:
        // this turn is the one they are about to read.
        follow()
        // The bubble is the row the gateway will store, read the same way: it
        // stamps its own attachment lines onto that row, so the text painted
        // here has to be the parsed one or a resume paints this turn twice.
        // A send that lands while a turn streams is a steer: the gateway stamps
        // that class on the stored row, and this copy has to read the same way or
        // the turn would split in two here and heal only on a reload.
        const bubble = runningRef.current
          ? { ...paintedRow('user', composed), kind: STEER_KIND }
          : paintedRow('user', composed)
        setMessages(prev => [...prev, bubble])
        // A cold rebuild owns the rows right now: it lands on top of this prompt,
        // so the prompt rides along and is replayed onto the rebuild's result.
        if (held.current) held.current.push({ local: bubble })
        setIsRunning(true)
        setSent(count => count + 1)
        setPending([])
        dropDraft(draftSurface)
        await gateway.submit(id, composed)
        if (newThread && topic && !filed.current) {
          filed.current = true
          const stored = storedSessionId || id
          try {
            await fileThread(stored, topic.id)
            // The thread is real from here on: whatever is typed next belongs to
            // it, not to the next press of the plus button.
            moveDraft(draftSurface, draftKeys.thread(stored))
            setDraftSurface(draftKeys.thread(stored))
          } catch (err) {
            setError(`Could not file this thread under ${topic.name}: ${messageOf(err)}`)
          }
        }
      } catch (err) {
        setIsRunning(false)
        setError(messageOf(err))
      }
    },
    [draftSurface, follow, liveId, newThread, pending, storedSessionId, topic]
  )

  const runtime = useExternalStoreRuntime({
    convertMessage: message => message,
    messages: toThreadMessages(messages),
    isRunning,
    onNew: async message => {
      const text = message.content
        .filter(part => part.type === 'text')
        .map(part => ('text' in part ? part.text : ''))
        .join('')
      await submit(text)
    }
  })

  /** What the transcript paints: a cron reply drops the delivery that seeded the thread, a run of tool steps folds into the one ellipsis line it earns, and the commentary a turn said before it answered reads quiet. The cron drop comes first and the fold before the last pass, so each sees the rows the screen really shows. */
  const painted = useMemo(
    () => markInterim(collapseToolSteps(hideDelivery ? hideCronDelivery(messages) : messages)),
    [messages, hideDelivery]
  )

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ComposerDraftSync draftText={draftText} sent={sent} onChange={onText} />
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-1 border-b border-white/10 px-2 py-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to threads"
            className="p-1.5 text-zinc-300 active:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="min-w-0 flex-1 truncate text-base font-medium">{title}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={fetching || refreshing}
            data-refresh-button
            aria-label="Refresh thread"
            className="p-1.5 text-zinc-300 active:text-white disabled:opacity-40"
          >
            <RefreshCw className="h-5 w-5" />
          </button>
        </header>
        <div className="relative flex-1 overflow-hidden">
          <div
            ref={scrollRef}
            data-transcript
            onScroll={trackScroll}
            className="h-full overflow-x-hidden overflow-y-auto py-2"
          >
            {painted.map((message, index) => (
              <MessageBubble
                key={index}
                role={message.role}
                text={message.text}
                attachments={message.attachments}
                interim={message.interim}
              />
            ))}
            {isRunning && <p className="px-4 py-1 text-xs text-zinc-500">Working…</p>}
            {error && <p className="px-4 py-1 text-xs text-red-400">{error}</p>}
          </div>
          <LoadingOverlay visible={loading} label="Loading messages…" />
        </div>
        <div className="safe-b border-t border-white/10 bg-surface">
          {pending.length > 0 && (
            <div className="px-2 pt-2">
              <AttachmentBar attachments={pending} onRemove={id => setPending(prev => removePending(prev, id))} />
            </div>
          )}
          <ComposerPrimitive.Root>
            <input
              ref={pickerRef}
              data-attach-input
              type="file"
              multiple
              tabIndex={-1}
              aria-hidden
              className="sr-only"
              onChange={event => void pickAttachments(event)}
            />
            <ComposerPrimitive.Input
              submitMode="none"
              placeholder="Message…"
              rows={1}
              className="block max-h-32 min-h-[44px] w-full resize-none rounded-none bg-transparent px-4 py-3 text-base leading-snug outline-none placeholder:text-zinc-500 [word-spacing:1px]"
            />
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button
                type="button"
                data-attach-button
                onClick={() => pickerRef.current?.click()}
                aria-label="Add attachment"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/20 text-zinc-300 active:text-white"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-model-button
                onClick={() => setSheet('model')}
                aria-label="Model picker"
                className="h-8 max-w-[42%] min-w-0 truncate rounded-lg border border-white/20 px-2 text-sm leading-8 text-zinc-300 active:text-white"
              >
                {modelLabel(composerModel.provider, composerModel.model)}
              </button>
              <button
                type="button"
                data-reasoning-button
                onClick={() => setSheet('reasoning')}
                aria-label="Reasoning picker"
                className="h-8 max-w-[35%] shrink-0 truncate rounded-lg border border-white/20 px-2 text-sm leading-8 text-zinc-300 active:text-white"
              >
                {reasoningLabel(effort)}
              </button>
              <div className="ml-auto flex shrink-0 items-center">
              {isRunning ? (
                <ComposerPrimitive.Cancel
                  aria-label="Stop"
                  data-stop-button
                  className="rounded-xl bg-white/10 p-2 text-zinc-200 active:text-white"
                >
                  <Square className="h-4 w-4 fill-current" />
                </ComposerPrimitive.Cancel>
              ) : (
                <button
                  type="button"
                  data-send-button
                  aria-label="Send"
                  onClick={() => void submit(draftText)}
                  disabled={!draftText.trim() && !pending.length}
                  className="rounded-xl bg-primary p-2 text-on-primary disabled:opacity-40"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
              </div>
            </div>
          </ComposerPrimitive.Root>
          <ModelSheet
            open={sheet === 'model'}
            onClose={() => setSheet(null)}
            current={composerModel}
            onLoad={loadModels}
            onPick={applyModel}
          />
          <ReasoningSheet
            open={sheet === 'reasoning'}
            onClose={() => setSheet(null)}
            value={effort}
            onChange={setEffort}
            onLoad={loadEffort}
            onPick={applyEffort}
          />
        </div>
      </div>
    </AssistantRuntimeProvider>
  )
}
