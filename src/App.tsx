import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { LinkOverlay } from './components/link-overlay'
import { LoadingOverlay } from './components/loading-overlay'
import { SignIn } from './components/sign-in'
import type { ChatMessage } from './lib/chat'
import { clearTokens, loadTokens } from './lib/config'
import { clearDrafts } from './lib/drafts'
import { SETTLE_MS, useEdgeSwipe, type Edge } from './lib/edge-swipe'
import { messageOf } from './lib/errors'
import { gateway, type LinkState } from './lib/gateway'
import { cacheKeys, clearCache, readCache, writeCache } from './lib/screen-cache'
import { listAllThreads, listThreads, listTopics, type CronResult, type ThreadRow, type TopicEntry } from './lib/topics'

const ChatView = lazy(() => import('./components/chat-view').then(m => ({ default: m.ChatView })))
const CronView = lazy(() => import('./components/cron-view').then(m => ({ default: m.CronView })))
const Settings = lazy(() => import('./components/settings').then(m => ({ default: m.Settings })))
const ThreadList = lazy(() => import('./components/thread-list').then(m => ({ default: m.ThreadList })))
const TopicList = lazy(() => import('./components/topic-list').then(m => ({ default: m.TopicList })))

/** The boot splash's fade, before it is removed from the DOM. */
const SPLASH_FADE_MS = 200

/** The longest the boot splash may cover the app. A fetch that never settles
 *  would otherwise leave it up over a screen the app is already showing. */
const SPLASH_MAX_MS = 10000

/** How long a screen slides. The nav animations in styles.css run for the same
 *  time, and the screen that slid out is unmounted when this has passed. */
const SLIDE_MS = 260

/** The pre-fetch warm-up, then how often the listing screens re-fetch on their own. The gateway pushes nothing to this client, so a thread another device started, or a stamp that moved, only lands when something asks: the screens ask on a timer. */
const PREFETCH_MS = 1200
const LIST_REFRESH_MS = 10000

/** The share of the width the screen behind a back swipe waits at, the same 30% the pop keyframes travel (styles.css). A right edge pull uses the same 30% for the list it pushes away. */
const PARALLAX_SHARE = 0.3

/** The id the new thread a right edge pull brings in is mounted under. It never reaches the gateway: a new thread has nothing to resume, so its screen is real from the first frame and the minted session only has to take its place. */
const PREVIEW_ID = 'new-thread-preview'

/** Whether the system asks for no motion: a released swipe then lands instead of travelling. */
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The newest thread per topic: the listing is newest-activity first, so the first row a topic appears on is its latest. */
function latestByTopic(threads: ThreadRow[]): Record<string, ThreadRow> {
  const latest: Record<string, ThreadRow> = {}
  for (const thread of threads) {
    if (!latest[thread.topic_id]) latest[thread.topic_id] = thread
  }
  return latest
}

type Route =
  | { kind: 'topics' }
  | { kind: 'settings' }
  | { kind: 'threads'; topic: TopicEntry }
  | {
      kind: 'chat'
      sessionId: string
      storedSessionId?: string
      title: string
      /** The cached transcript, or null when none is stored: the chat then waits
       *  for its own resume before it has anything to show. */
      messages: ChatMessage[] | null
      /** The topic this chat was opened from, which its back button returns to. */
      topic?: TopicEntry
      /** A screen this chat was pushed from and must hand back to: a reply opens
       *  from a cron reader, whose own back still returns to the thread list. */
      backTo?: Route
      /** A reply into a scheduled run's seeded thread: its opening row is the
       *  delivery the reader already shows, so the chat does not paint it. */
      hideDelivery?: boolean
      /** True for a chat the plus button minted: its first prompt files it. */
      newThread?: boolean
    }
  | {
      kind: 'cron'
      sessionId: string
      title: string
      /** The cached result, or null when none is stored: the screen then waits
       *  for its own fetch before it has anything to show. */
      result: CronResult | null
      /** The plugin's own listing flag: a mirrored run thread whose seed is
       *  live. It is what earns the reply button and the right edge swipe, and a
       *  bare run row never has it. */
      replyable: boolean
      /** The topic this result was opened from, which its back button returns to. */
      topic?: TopicEntry
    }

/** How deep a screen sits: a push goes deeper, a pop comes back. */
const DEPTH: Record<Route['kind'], number> = { topics: 0, settings: 1, threads: 1, chat: 2, cron: 2 }

interface TopicsRows {
  topics: TopicEntry[]
  latest: Record<string, ThreadRow>
}

interface ListState<T> {
  rows: T
  /** Nothing truthful to show yet: the screen covers itself until this is false. */
  loading: boolean
}

/** Whatever a screen reads from the gateway, kept aside for the moment it
 *  slides out: it must not repaint with the list the screen arriving behind it
 *  is fetching. */
interface Frozen {
  topics: TopicEntry[]
  latest: Record<string, ThreadRow>
  threads: ThreadRow[]
}

interface Live {
  topics: TopicEntry[]
  latest: Record<string, ThreadRow>
  threads: Record<string, ListState<ThreadRow[]>>
}

/** A screen's place in the navigation. `key` names the navigation rather than
 *  the route: a chat adopting the runtime session id a resume answers with is
 *  the same screen, and remounting it there would reload the whole chat. */
interface View {
  key: number
  route: Route
}

interface Nav {
  current: View
  /** The screen sliding out, dropped once its animation has run. */
  leaving: View | null
  /** The lists that screen keeps rendering while it slides: frozen at the
   *  moment of navigation, because the live ones already belong to its
   *  successor. */
  leavingFrozen: Frozen
  direction: 'forward' | 'back'
  /** The layers are already where this navigation puts them: no slide runs. */
  instant: boolean
}

/** A finger on an edge: the screen follows it, and the screen a pop would land on is drawn behind it. */
interface Swipe {
  edge: Edge
  /** The screen width the travel is measured against. */
  width: number
  /** Released: the layers are travelling to where the gesture ends. */
  settling: boolean
  /** The release goes through. */
  commit: boolean
}

function emptyFrozen(): Frozen {
  return { topics: [], latest: {}, threads: [] }
}

/** Navigation to the screen already on top: a second tap on a row is not a
 *  second screen. */
function sameScreen(from: Route, to: Route): boolean {
  if (from.kind !== to.kind) return false
  if (from.kind === 'threads' && to.kind === 'threads') return from.topic.id === to.topic.id
  if (from.kind === 'chat' && to.kind === 'chat') return from.sessionId === to.sessionId
  if (from.kind === 'cron' && to.kind === 'cron') return from.sessionId === to.sessionId
  return true
}

/** Where a pop from this screen lands: the same target for the back button and for a swipe. */
function backRoute(from: Route): Route {
  // A reply's chat hands back to the reader it was opened from. Its result is
  // re-read from the cache: a delivered document never changes, and the route
  // object was captured before that first fetch answered, so its own copy can
  // still be the null the pane was raised for.
  if (from.kind === 'chat' && from.backTo) {
    const target = from.backTo
    if (target.kind !== 'cron') return target
    return { ...target, result: readCache<CronResult>(cacheKeys.cron(target.sessionId)) ?? target.result }
  }
  if ((from.kind === 'chat' || from.kind === 'cron') && from.topic) return { kind: 'threads', topic: from.topic }
  return { kind: 'topics' }
}

/** The chat a replyable cron result continues. The row's own session id IS the seeded thread (the plugin hands the mirror back), so the reply opens the same thread the desktop reader's Reply opens, on the cached transcript when there is one. A row the plugin did not prove replyable answers null: a run has no chat to open. */
function replyRoute(from: Extract<Route, { kind: 'cron' }>): Route | null {
  if (!from.replyable) return null
  return {
    kind: 'chat',
    sessionId: from.sessionId,
    storedSessionId: from.sessionId,
    title: from.title,
    messages: readCache<ChatMessage[]>(cacheKeys.messages(from.sessionId)),
    topic: from.topic,
    backTo: from,
    hideDelivery: true
  }
}

function slideClass(nav: Nav, live: boolean): string {
  // A swipe has already carried the layers to where the navigation puts them.
  if (nav.instant) return ''
  if (live) {
    if (!nav.leaving) return ''
    return nav.direction === 'forward' ? 'nav-enter-forward' : 'nav-enter-back'
  }
  return nav.direction === 'forward' ? 'nav-leave-forward nav-leaving' : 'nav-leave-back nav-leaving'
}

/** The pane's wording for a route, so the fallback a lazy screen shows while its
 *  own chunk loads reads as the same wait that screen would have raised. */
function paneLabel(route: Route): string {
  if (route.kind === 'threads') return 'Loading threads…'
  if (route.kind === 'settings') return 'Loading settings…'
  if (route.kind === 'chat') return 'Loading messages…'
  if (route.kind === 'cron') return 'Loading result…'
  return 'Loading topics…'
}

/** The boot splash is inline in index.html, outside React's tree. React is what knows the topics list has painted, so React is what takes it down. */
function releaseBootSplash() {
  const splash = document.getElementById('boot-splash')
  if (!splash) return
  splash.classList.add('boot-splash-out')
  window.setTimeout(() => splash.remove(), SPLASH_FADE_MS)
}

export function App() {
  const [signedIn, setSignedIn] = useState(() => loadTokens() !== null)
  const [nav, setNav] = useState<Nav>(() => ({
    current: { key: 0, route: { kind: 'topics' } },
    leaving: null,
    leavingFrozen: emptyFrozen(),
    direction: 'forward',
    instant: false
  }))
  /** The registry is read back from the cache before the first paint: a
   *  relaunch must not raise a pane over rows the app already has, and the fetch
   *  that corrects them runs as soon as the link is up. */
  const [topicsScreen, setTopicsScreen] = useState<ListState<TopicsRows>>(() => {
    const cached = readCache<TopicsRows>(cacheKeys.topics())
    return cached ? { rows: cached, loading: false } : { rows: { topics: [], latest: {} }, loading: true }
  })
  const [threadsScreen, setThreadsScreen] = useState<Record<string, ListState<ThreadRow[]>>>({})
  const [link, setLink] = useState<LinkState>(gateway.connectionState)
  const [repairing, setRepairing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The current header's height: where the link overlay is pinned. */
  const [headerHeight, setHeaderHeight] = useState(0)
  const shellRef = useRef<HTMLDivElement>(null)
  const connected = useRef(false)
  const opened = useRef(false)
  const routeRef = useRef<Route>(nav.current.route)
  const liveRef = useRef<Live>({ topics: [], latest: {}, threads: {} })
  const keyRef = useRef(1)

  useEffect(() => {
    routeRef.current = nav.current.route
  })

  /** What the live screens are showing right now, read back when one of them
   *  has to keep rendering after it was navigated away from. */
  useEffect(() => {
    liveRef.current = { topics: topicsScreen.rows.topics, latest: topicsScreen.rows.latest, threads: threadsScreen }
  })

  /** Push a screen. The one on top starts sliding out and keeps the lists it was
   *  showing; a navigation to where we already are is ignored. `pop` forces the
   *  back direction, which the depth cannot tell apart when a reply hands a
   *  reader back: both screens sit at the same depth. */
  const navigate = useCallback((route: Route, instant = false, pop = false) => {
    const from = routeRef.current
    if (sameScreen(from, route)) return
    // A swipe has already slid the layers there, so the pop only has to swap them.
    if (instant) {
      setNav({
        current: { key: keyRef.current++, route },
        leaving: null,
        leavingFrozen: emptyFrozen(),
        direction: 'back',
        instant: true
      })
      return
    }
    const live = liveRef.current
    const leavingFrozen: Frozen = {
      topics: live.topics,
      latest: live.latest,
      threads: from.kind === 'threads' ? (live.threads[from.topic.id]?.rows ?? []) : []
    }
    setNav(prev => ({
      current: { key: keyRef.current++, route },
      leaving: prev.current,
      leavingFrozen,
      direction: pop ? 'back' : DEPTH[route.kind] >= DEPTH[from.kind] ? 'forward' : 'back',
      instant: false
    }))
  }, [])

  useEffect(() => {
    const leaving = nav.leaving
    if (!leaving) return
    const timer = window.setTimeout(() => {
      setNav(prev => (prev.leaving === leaving ? { ...prev, leaving: null } : prev))
    }, SLIDE_MS)
    return () => window.clearTimeout(timer)
  }, [nav.leaving])

  /** The topics screen. A cached registry paints at once and the fetch corrects
   *  it behind the screen; without one the pane covers the list until it lands. A
   *  silent fetch (the timer, not a gesture or a navigation) leaves the rows it
   *  could not refresh alone and paints no banner. */
  const loadTopics = useCallback(async (silent = false) => {
    const cached = readCache<TopicsRows>(cacheKeys.topics())
    if (cached) setTopicsScreen({ rows: cached, loading: false })
    // A silent fetch leaves the banner alone: it neither paints a failure nor
    // takes away one the user is still reading.
    if (!silent) setError(null)
    try {
      const [entries, allThreads] = await Promise.all([listTopics(), listAllThreads()])
      const rows: TopicsRows = { topics: entries, latest: latestByTopic(allThreads.threads) }
      writeCache(cacheKeys.topics(), rows)
      setTopicsScreen({ rows, loading: false })
    } catch (err) {
      setTopicsScreen(prev => ({ ...prev, loading: false }))
      if (!silent) setError(messageOf(err))
    }
  }, [])

  /** One topic's threads, cached per topic: the rows are only ever the ones that
   *  topic was fetched with, so a background refresh never repaints another. */
  const loadThreads = useCallback(async (topicId: string, silent = false) => {
    const cached = readCache<ThreadRow[]>(cacheKeys.threads(topicId))
    setThreadsScreen(prev => {
      const known = cached ?? prev[topicId]?.rows ?? null
      return { ...prev, [topicId]: { rows: known ?? [], loading: known === null } }
    })
    if (!silent) setError(null)
    try {
      const page = await listThreads(topicId)
      writeCache(cacheKeys.threads(topicId), page.threads)
      setThreadsScreen(prev => ({ ...prev, [topicId]: { rows: page.threads, loading: false } }))
    } catch (err) {
      setThreadsScreen(prev => ({ ...prev, [topicId]: { rows: prev[topicId]?.rows ?? [], loading: false } }))
      if (!silent) setError(messageOf(err))
    }
  }, [])

  /** Whatever the visible screen reads from the gateway. A chat re-syncs itself
   *  from its own effect, so it is deliberately not reloaded here. */
  const refreshRoute = useCallback(
    (silent = false) => {
      const current = routeRef.current
      if (current.kind === 'threads') return loadThreads(current.topic.id, silent)
      if (current.kind === 'topics') return loadTopics(silent)
      return Promise.resolve()
    },
    [loadThreads, loadTopics]
  )

  /** Background refetch. The listing screens ask again on a timer, so a thread
   *  started elsewhere, or a stamp that moved, lands without a tap. It is silent
   *  (the rows are corrected in place, no pane, no banner), it never runs on a
   *  chat - that screen keeps its own transcript - and it waits while the app is
   *  hidden or the link is down. */
  useEffect(() => {
    if (!signedIn) return
    const tick = () => {
      if (document.hidden) return
      if (gateway.connectionState !== 'open') return
      void refreshRoute(true)
    }
    const timer = window.setInterval(tick, LIST_REFRESH_MS)
    // iOS suspends the webview's timers while the app is in the background, so
    // the first tick after coming back can be a whole interval away: ask at once.
    const onVisible = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [signedIn, refreshRoute])

  useEffect(() => {
    return gateway.onState(state => {
      setLink(state)
      if (state === 'open') {
        // Every open, including the first, is what loads the visible screen: a
        // list fetched through a dead socket's window would stay stale.
        opened.current = true
        setRepairing(false)
        setError(null)
        void refreshRoute()
        return
      }
      if (opened.current) setRepairing(true)
    })
  }, [refreshRoute])

  /** The overlay is pinned at the current header's own height, measured rather
   *  than assumed: the three screens' headers are not the same size, and while a
   *  navigation slides there are two of them. Runs on every render but only
   *  measures while an overlay is up. */
  const overlayVisible = repairing || error !== null
  useLayoutEffect(() => {
    if (!overlayVisible) return
    let frames = 0
    let frame = 0
    const measure = () => {
      const layer = shellRef.current?.querySelector('[data-nav="current"]')
      const header = layer?.querySelector('header')
      if (header) {
        setHeaderHeight(Math.round(header.getBoundingClientRect().height))
        return
      }
      // A lazy screen can still be showing its fallback here.
      if (frames++ < 10) frame = requestAnimationFrame(measure)
    }
    measure()
    return () => cancelAnimationFrame(frame)
  })

  /** The boot splash covers the topics screen's own loading pane, so it stands
   *  until that list is rendered: its rows, an empty registry, or the failure
   *  banner that replaces either. Nothing else moves it - a link that flaps
   *  mid-boot must not drop the splash onto an empty spinner, which is what
   *  putting error or repairing in this condition does. Two frames on the way
   *  out, because the first commits the list and the second proves it painted. */
  const bootSplashHold = signedIn && nav.current.route.kind === 'topics' && topicsScreen.loading
  useEffect(() => {
    if (bootSplashHold) {
      const watchdog = window.setTimeout(releaseBootSplash, SPLASH_MAX_MS)
      return () => window.clearTimeout(watchdog)
    }
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(releaseBootSplash)
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [bootSplashHold])

  useEffect(() => {
    if (!signedIn || connected.current) return
    connected.current = true
    gateway.connect().catch(err => setError(messageOf(err)))
  }, [signedIn])

  useEffect(() => {
    if (!signedIn) return
    const timer = window.setTimeout(() => {
      void import('./components/thread-list')
      void import('./components/chat-view')
      void import('./components/cron-view')
    }, PREFETCH_MS)
    return () => window.clearTimeout(timer)
  }, [signedIn])

  /** The layers an edge swipe moves. Written straight to the DOM: a finger at 60Hz must not re-render the screen it is dragging. `peek` is the screen behind a back swipe, `incoming` the new thread a right edge pull brings in. */
  const swipeLayers = useRef<{ current: HTMLDivElement | null; peek: HTMLDivElement | null; incoming: HTMLDivElement | null }>({
    current: null,
    peek: null,
    incoming: null
  })
  const attachCurrent = useCallback((el: HTMLDivElement | null) => {
    swipeLayers.current.current = el
  }, [])
  const attachPeek = useCallback((el: HTMLDivElement | null) => {
    swipeLayers.current.peek = el
  }, [])
  const attachIncoming = useCallback((el: HTMLDivElement | null) => {
    swipeLayers.current.incoming = el
  }, [])
  const [swipe, setSwipe] = useState<Swipe | null>(null)
  /** The new thread screen a right edge pull is bringing in, on its own route so it
   *  survives the gesture ending: it stands at rest until the minted thread takes
   *  its place in one frame. */
  const [preview, setPreview] = useState<Route | null>(null)
  /** The gesture as the touch handlers see it: the render only needs to know that one is running, the travel itself never goes through React. */
  const swipeRef = useRef<Swipe | null>(null)
  const holdSwipe = useCallback((next: Swipe | null) => {
    swipeRef.current = next
    setSwipe(next)
  }, [])

  /** Move the layers a swipe draws. A back swipe pulls the screen aside over the one behind it, which travels in from the 30% the pop keyframes start at; a right edge pull moves the list with the finger. */
  const paintSwipe = useCallback((travel: number, settle: boolean) => {
    const running = swipeRef.current
    if (!running) return
    const back = running.edge === 'left'
    const duration = settle && !prefersReducedMotion() ? SETTLE_MS : 0
    const paint = (layer: HTMLDivElement | null, x: number) => {
      if (!layer) return
      layer.style.transition = duration ? `transform ${duration}ms cubic-bezier(0.32, 0.72, 0, 1)` : 'none'
      // The transition has to be in place before the value moves, or a release lands on its end in one frame.
      if (duration) void layer.offsetWidth
      layer.style.transform = `translateX(${x}px)`
    }
    paint(swipeLayers.current.current, back ? travel : -PARALLAX_SHARE * travel)
    paint(swipeLayers.current.peek, back ? -PARALLAX_SHARE * (running.width - travel) : 0)
    paint(swipeLayers.current.incoming, back ? 0 : running.width - travel)
  }, [])

  /** Edge swipes: the left edge pops to the screen a back button reaches, the right edge opens a new thread on a thread list and continues a replyable scheduled run on its reader. Nothing starts while a screen is already sliding. */
  useEdgeSwipe({
    canStart: edge => {
      if (swipeRef.current || nav.leaving || creating) return false
      const route = nav.current.route
      if (edge === 'left') return DEPTH[route.kind] > 0
      // A right edge pull is a promise of a screen to land on: a run row has none.
      return route.kind === 'threads' || (route.kind === 'cron' && replyRoute(route) !== null)
    },
    onStart: (edge, width) => {
      holdSwipe({ edge, width, settling: false, commit: false })
      // A right edge pull carries the screen it will land on in under the finger,
      // so the gesture only has to put the session behind it.
      const route = routeRef.current
      if (edge !== 'right') return
      if (route.kind === 'threads') {
        setPreview({ kind: 'chat', sessionId: PREVIEW_ID, title: 'New thread', messages: [], topic: route.topic, newThread: true })
        return
      }
      if (route.kind === 'cron') {
        // The seeded thread itself, not a placeholder: it has a real session to
        // resume, so the screen the finger drags in is the screen it lands on.
        const target = replyRoute(route)
        if (target) setPreview(target)
      }
    },
    onMove: travel => {
      if (swipeRef.current?.settling !== false) return
      paintSwipe(travel, false)
    },
    onEnd: commit => {
      const running = swipeRef.current
      if (!running) return
      const back = running.edge === 'left'
      holdSwipe({ ...running, settling: true, commit })
      // Both gestures land at the same travel: a back swipe ends with the screen it
      // reveals at rest, a right edge pull with the screen it brings in at rest.
      paintSwipe(commit ? running.width : 0, true)
      if (back || commit) return
      setPreview(null)
    }
  })

  /** A released gesture travels for SETTLE_MS, then the app either lands where it went or forgets it. */
  useEffect(() => {
    if (!swipe?.settling) return
    const settled = swipe
    const timer = window.setTimeout(() => {
      if (settled.edge === 'right') {
        const route = routeRef.current
        if (!settled.commit || (route.kind !== 'threads' && route.kind !== 'cron')) {
          setPreview(null)
          holdSwipe(null)
          return
        }
        if (route.kind === 'threads') {
          // The new thread's screen is already up: only the session is missing.
          void landPreview(route.topic)
          return
        }
        // A reply's screen is already at rest too, on the real session: it takes
        // the preview's place in one frame rather than sliding in over itself.
        const target = replyRoute(route)
        setPreview(null)
        holdSwipe(null)
        if (target) navigate(target, true)
        return
      }
      holdSwipe(null)
      if (!settled.commit) return
      const target = backRoute(routeRef.current)
      navigate(target, true)
      if (target.kind === 'threads') void loadThreads(target.topic.id)
      else void loadTopics()
    }, SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [swipe, holdSwipe, navigate, loadThreads, loadTopics])

  /** Land the new thread a right edge pull brought in: its screen is already at rest, so the minted thread takes its place in one frame instead of sliding in over it. A mint that fails slides the preview back out. */
  async function landPreview(topic: TopicEntry) {
    try {
      const created = await gateway.createSession()
      setPreview(null)
      holdSwipe(null)
      navigate(
        {
          kind: 'chat',
          sessionId: created.session_id,
          storedSessionId: created.stored_session_id,
          title: 'New thread',
          messages: [],
          topic,
          newThread: true
        },
        true
      )
    } catch (err) {
      setError(messageOf(err))
      paintSwipe(0, true)
      setPreview(null)
      holdSwipe(null)
    }
  }

  /** A chat opens on its cached transcript, if there is one, and fetches the
   *  rest itself; without a cache it opens covered by the pane and shows the
   *  live transcript when the resume lands. */
  function openThread(topic: TopicEntry, thread: ThreadRow) {
    // A scheduled run's result is read, not chatted: it opens the read only result
    // screen, which has no composer and never resumes the session. The row's own
    // flag comes from the plugin's delivery ledger, so an app minted thread that
    // merely shares the source never takes this path.
    if (thread.cron_result) {
      navigate({
        kind: 'cron',
        sessionId: thread.session_id,
        title: thread.title || 'Scheduled run',
        result: readCache<CronResult>(cacheKeys.cron(thread.session_id)),
        replyable: thread.replyable === true,
        topic
      })
      return
    }
    navigate({
      kind: 'chat',
      sessionId: thread.session_id,
      storedSessionId: thread.session_id,
      title: thread.title || 'Untitled thread',
      messages: readCache<ChatMessage[]>(cacheKeys.messages(thread.session_id)),
      topic
    })
  }

  function openTopic(topic: TopicEntry) {
    navigate({ kind: 'threads', topic })
    void loadThreads(topic.id)
  }

  /** Reply: hand the seeded thread behind a cron result to the chat screen, pushed over the reader. */
  function openReply(from: Extract<Route, { kind: 'cron' }>) {
    const target = replyRoute(from)
    if (target) navigate(target)
  }

  function openSettings() {
    navigate({ kind: 'settings' })
  }

  function goBack() {
    const target = backRoute(routeRef.current)
    // Always a pop: a reader handed back by its reply chat is the same depth as
    // the chat, so the depth alone would slide it in the pushing direction.
    navigate(target, false, true)
    if (target.kind === 'threads') void loadThreads(target.topic.id)
    else void loadTopics()
  }

  async function startThread(topic: TopicEntry) {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const created = await gateway.createSession()
      navigate({
        kind: 'chat',
        sessionId: created.session_id,
        storedSessionId: created.stored_session_id,
        title: 'New thread',
        messages: [],
        topic,
        newThread: true
      })
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setCreating(false)
    }
  }

  /** Drop the cached payloads and the rows they painted. The cache alone is not
   *  enough: a screen already holding rows in state would keep drawing them, so
   *  the next open fetches instead. */
  function clearScreens() {
    clearCache()
    setTopicsScreen({ rows: { topics: [], latest: {} }, loading: true })
    setThreadsScreen({})
  }

  async function signOut() {
    gateway.stop()
    try {
      await clearTokens()
    } catch {
      // The memory copy is already gone; a stale Keychain item is rejected on the next refresh, which drops the app back to this gate.
    }
    // Nothing cached is the next session's: the rows, and the transcripts that
    // name them, are gone with the tokens they were read with.
    clearScreens()
    clearDrafts()
    connected.current = false
    opened.current = false
    setRepairing(false)
    setError(null)
    setNav({
      current: { key: keyRef.current++, route: { kind: 'topics' } },
      leaving: null,
      leavingFrozen: emptyFrozen(),
      direction: 'forward',
      instant: false
    })
    setSignedIn(false)
  }

  function renderScreen(route: Route, live: boolean, frozen: Frozen) {
    if (route.kind === 'topics') {
      return (
        <TopicList
          topics={live ? topicsScreen.rows.topics : frozen.topics}
          latest={live ? topicsScreen.rows.latest : frozen.latest}
          loading={live && topicsScreen.loading && error === null}
          onRefresh={() => loadTopics()}
          onOpen={openTopic}
          onOpenSettings={openSettings}
        />
      )
    }
    if (route.kind === 'settings') {
      return <Settings onBack={goBack} onClearCache={clearScreens} onSignOut={signOut} />
    }
    if (route.kind === 'threads') {
      const state = live ? threadsScreen[route.topic.id] : undefined
      return (
        <ThreadList
          topic={route.topic}
          threads={live ? (state?.rows ?? []) : frozen.threads}
          loading={live && (state?.loading ?? true) && error === null}
          creating={live && creating}
          onRefresh={() => loadThreads(route.topic.id)}
          onBack={goBack}
          onOpen={thread => openThread(route.topic, thread)}
          onNewThread={() => void startThread(route.topic)}
        />
      )
    }
    if (route.kind === 'cron') {
      return (
        <CronView
          sessionId={route.sessionId}
          title={route.title}
          replyable={route.replyable}
          initialResult={route.result}
          onBack={goBack}
          onReply={() => openReply(route)}
        />
      )
    }
    return (
      <ChatView
        sessionId={route.sessionId}
        storedSessionId={route.storedSessionId}
        initialMessages={route.messages}
        title={route.title}
        topic={route.topic}
        newThread={route.newThread}
        hideDelivery={route.hideDelivery}
        onBack={goBack}
      />
    )
  }

  // One overlay, one surface: while the link is being repaired every failure a
  // REST call could paint has the same cause, and the open clears it.
  const overlay = repairing
    ? { text: 'Reconnecting…', tone: 'info' as const }
    : error
      ? { text: error, tone: 'error' as const }
      : null

  const layers = nav.leaving ? [nav.leaving, nav.current] : [nav.current]
  /** The screen a back swipe reveals: the same route the pop lands on, drawn under the screen the finger drags. */
  const peek = swipe && swipe.edge === 'left' ? backRoute(nav.current.route) : null
  /** The screens are memoized on the data they read and never on the gesture: a re-render of this component while a finger is down rebuilds the chat's transcript DOM, and the touch sequence dies with the node it started on. */
  const currentScreen = useMemo(
    () => renderScreen(nav.current.route, true, nav.leavingFrozen),
    [nav.current, nav.leavingFrozen, topicsScreen, threadsScreen, creating, error]
  )
  const leavingScreen = useMemo(
    () => (nav.leaving ? renderScreen(nav.leaving.route, false, nav.leavingFrozen) : null),
    [nav.leaving, nav.leavingFrozen]
  )
  const peekScreen = useMemo(
    () => (peek ? renderScreen(peek, true, nav.leavingFrozen) : null),
    [peek, nav.leavingFrozen, topicsScreen, threadsScreen, creating, error]
  )
  const previewScreen = useMemo(
    () => (preview ? renderScreen(preview, true, nav.leavingFrozen) : null),
    [preview, nav.leavingFrozen, topicsScreen, threadsScreen, creating, error]
  )

  /** The gate returns AFTER every hook: signing out flips this flag on a mounted
   *  component, so a return above the hooks changes the hook count between two
   *  renders (React error 300) instead of drawing the gate. */
  if (!signedIn) return <SignIn onSignedIn={() => setSignedIn(true)} />

  return (
    <div ref={shellRef} className="relative flex h-full flex-col">
      {overlay && <LinkOverlay text={overlay.text} tone={overlay.tone} top={headerHeight} />}
      {/* The screens are stacked, not laid out: the one arriving slides over the
          one leaving, which stays mounted behind it until the slide is done. */}
      <div className="relative flex-1 overflow-hidden">
        {swipe && peek && (
          <div
            ref={attachPeek}
            data-nav="peek"
            data-screen={peek.kind}
            inert
            // The finger moves it from here; this is where a pop would start it.
            style={{ transform: `translateX(${-PARALLAX_SHARE * swipe.width}px)` }}
            className="nav-layer nav-leaving absolute inset-0 bg-screen"
          >
            <Suspense fallback={null}>{peekScreen}</Suspense>
          </div>
        )}
        {layers.map((view, index) => {
          const live = index === layers.length - 1
          return (
            <div
              key={view.key}
              ref={live ? attachCurrent : undefined}
              data-nav={live ? 'current' : 'leaving'}
              data-screen={view.route.kind}
              data-swipe={live && swipe ? (swipe.settling ? (swipe.commit ? 'commit' : 'cancel') : 'drag') : undefined}
              // The screen sliding out is there to be seen and nothing else: taps
              // and assistive tech belong to the screen arriving.
              inert={!live}
              // The layer paints the app background itself: without it the
              // transparent screen arriving lets the one leaving show through,
              // and both screens' text overlap until the slide ends.
              className={`nav-layer absolute inset-0 bg-screen ${slideClass(nav, live)}`}
            >
              <Suspense
                fallback={
                  <div className="relative h-full">
                    <LoadingOverlay visible label={paneLabel(view.route)} />
                  </div>
                }
              >
                {live ? currentScreen : leavingScreen}
              </Suspense>
            </div>
          )
        })}
        {preview && (
          <div
            ref={attachIncoming}
            data-nav="preview"
            data-screen={preview.kind}
            inert
            // The finger carries it in from here; this is where a push starts it.
            style={{ transform: 'translateX(100%)' }}
            className="nav-layer absolute inset-0 bg-screen"
          >
            <Suspense fallback={null}>{previewScreen}</Suspense>
          </div>
        )}
      </div>
    </div>
  )
}
