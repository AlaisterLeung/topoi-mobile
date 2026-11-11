// @vitest-environment jsdom
/**
 * What the composer's two sheets promise, observed on a real render: the model
 * sheet groups providers and lists the MoA presets, a row pick closes, the
 * reasoning sheet marks the live effort and its toggle writes the gateway's own
 * off value, and the frame is a body portal marked for the edge-swipe guard.
 *
 * Named .test.ts with no JSX because vitest collects only .test.ts under src.
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelOptions } from '../../lib/model-catalog'
import { ModelSheet } from './model-sheet'
import { ReasoningSheet } from './reasoning-sheet'
import { Sheet } from './sheet'

let host: HTMLDivElement
let root: Root
let scrollSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  // jsdom implements no scrollIntoView, so the model sheet's open-time jump
  // throws in EVERY leg that paints it without this stub.
  scrollSpy = vi.fn()
  ;(Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollSpy
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
})

function paint(element: ReactElement) {
  act(() => root.render(element))
}

/** Let a sheet's on-open read settle inside act. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
  })
}

const catalogue: ModelOptions = {
  model: 'deepseek-v4.1-flash',
  provider: 'opencode-go',
  providers: [
    { slug: 'opencode-go', name: 'OpenCode Go', models: ['deepseek-v4.1-flash', 'z-ai/glm-5.3-flash'] },
    { slug: 'moa', name: 'Mixture of Agents', models: ['default'], warning: 'references only advise' }
  ]
}

/** A catalogue whose current model is NOT the first row: first-row-active would
 *  prove nothing about scrolling. */
const deepCatalogue: ModelOptions = {
  providers: [
    { slug: 'nous', name: 'Nous Portal', models: ['alpha-1', 'alpha-2', 'alpha-3'] },
    { slug: 'opencode-go', name: 'OpenCode Go', models: ['z-ai/glm-5.3-flash', 'deepseek-v4.1-flash'] },
    { slug: 'moa', name: 'Mixture of Agents', models: ['default'] }
  ]
}

describe('the composer sheets', () => {
  it('portals the frame to the body and closes on the backdrop', () => {
    const onClose = vi.fn()
    paint(createElement(Sheet, { children: createElement('p', null, 'row'), open: true, onClose, title: 'Model' }))

    const frame = document.querySelector('[data-sheet-root]')
    expect(frame?.parentElement).toBe(document.body)
    expect(document.querySelector('[data-sheet="model"]')).not.toBeNull()

    const backdrop = document.querySelector('[data-sheet-backdrop]') as HTMLButtonElement
    act(() => backdrop.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing while it is closed', () => {
    paint(
      createElement(Sheet, { children: createElement('p'), open: false, onClose: () => {}, title: 'Model' })
    )
    expect(document.querySelector('[data-sheet-root]')).toBeNull()
  })

  it('groups providers, lists the MoA presets and closes on a pick', async () => {
    const picked: string[][] = []
    const onClose = vi.fn()
    paint(
      createElement(ModelSheet, {
        open: true,
        onClose,
        current: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
        onLoad: () => Promise.resolve(catalogue),
        onPick: (provider: string, model: string) => {
          picked.push([provider, model])
        }
      })
    )
    await settle()

    const headers = [...document.querySelectorAll('h2')].map(node => node.textContent)
    expect(headers).toEqual(['OpenCode Go', 'MoA presets'])
    expect(document.querySelector('[data-sheet-item="moa/default"]')).not.toBeNull()

    // The presets are ANCHORED: their own section carries the rule and sits
    // outside the model scroller, and the provider note is gone.
    const presets = document.querySelector('[data-moa-presets]') as HTMLElement
    expect(presets.classList.contains('border-t')).toBe(true)
    expect(presets.closest('.overflow-y-auto')).toBeNull()
    expect(document.body.textContent).not.toContain('references only advise')

    act(() => (document.querySelector('[data-sheet-item="moa/default"]') as HTMLButtonElement).click())
    expect(picked).toEqual([['moa', 'default']])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('drops the header row: no title text, no close button', async () => {
    paint(
      createElement(ModelSheet, {
        open: true,
        onClose: () => {},
        current: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
        onLoad: () => Promise.resolve(catalogue),
        onPick: () => {}
      })
    )
    await settle()

    // No title text and no close button: the grab handle and the backdrop are
    // the only exits.
    const panel = document.querySelector('[data-sheet="model"]') as HTMLElement
    expect(panel.querySelector('[aria-label="Close"]')).toBeNull()
    // The dialog label still names the sheet for assistive tech.
    expect(panel.getAttribute('aria-label')).toBe('Model')
  })

  it('fits the reasoning panel to its content and keeps the model panel tall', async () => {
    paint(
      createElement(ReasoningSheet, {
        open: true,
        onClose: () => {},
        value: 'high',
        onChange: () => {},
        onLoad: () => Promise.resolve('high'),
        onPick: () => Promise.resolve()
      })
    )
    await settle()
    const reasoning = document.querySelector('[data-sheet="reasoning"]') as HTMLElement
    // Content-sized: a max-height and no height, so no reserved space under Ultra.
    expect(reasoning.style.maxHeight).not.toBe('')
    expect(reasoning.style.height).toBe('')

    paint(
      createElement(ModelSheet, {
        open: true,
        onClose: () => {},
        current: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
        onLoad: () => Promise.resolve(catalogue),
        onPick: () => {}
      })
    )
    await settle()
    const models = document.querySelector('[data-sheet="model"]') as HTMLElement
    // A fixed two thirds: a long catalogue needs the height up front.
    expect(models.style.height).not.toBe('')
    expect(models.style.maxHeight).toBe('')
  })

  it('opens scrolled to the current model, not to the top of the list', async () => {
    paint(
      createElement(ModelSheet, {
        open: true,
        onClose: () => {},
        current: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
        onLoad: () => Promise.resolve(deepCatalogue),
        onPick: () => {}
      })
    )
    await settle()

    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    // The receiver, not just the call: `mock.instances` only fills for `new`.
    const target = scrollSpy.mock.contexts[0] as HTMLElement
    expect(target.getAttribute('data-sheet-item')).toBe('opencode-go/deepseek-v4.1-flash')
  })

  it('leaves the list alone when the current model is not in the catalogue', async () => {
    paint(
      createElement(ModelSheet, {
        open: true,
        onClose: () => {},
        current: { provider: '', model: 'not-in-any-catalogue' },
        onLoad: () => Promise.resolve(deepCatalogue),
        onPick: () => {}
      })
    )
    await settle()

    // Never a fallback scroll to the top on a miss.
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('re-reads the catalogue on reopen and scrolls once against the fresh list', async () => {
    const first: ModelOptions = {
      providers: [{ slug: 'nous', name: 'Nous Portal', models: ['alpha-1', 'alpha-2'] }]
    }
    const second: ModelOptions = {
      providers: [
        { slug: 'nous', name: 'Nous Portal', models: ['alpha-1', 'alpha-2'] },
        { slug: 'opencode-go', name: 'OpenCode Go', models: ['deepseek-v4.1-flash'] }
      ]
    }
    const render = (open: boolean, options: ModelOptions, model: string) =>
      paint(
        createElement(ModelSheet, {
          open,
          onClose: () => {},
          current: { provider: 'opencode-go', model },
          onLoad: () => Promise.resolve(options),
          onPick: () => {}
        })
      )

    render(true, first, 'deepseek-v4.1-flash')
    await settle()
    // Nothing in the first catalogue matches, so nothing is claimed.
    expect(scrollSpy).not.toHaveBeenCalled()

    render(false, first, 'deepseek-v4.1-flash')
    render(true, second, 'deepseek-v4.1-flash')
    await settle()

    // Exactly one jump, into the row the SECOND catalogue carries: the close
    // dropped the stale list instead of scrolling the reopen into it.
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect((scrollSpy.mock.contexts[0] as HTMLElement).getAttribute('data-sheet-item')).toBe(
      'opencode-go/deepseek-v4.1-flash'
    )
  })

  it('never ticks the same tail twice, and ticks it once when the provider is known', async () => {
    const collision: ModelOptions = {
      providers: [
        { slug: 'nous', name: 'Nous Portal', models: ['claude-fable-5'] },
        { slug: 'openrouter', name: 'OpenRouter', models: ['claude-fable-5'] }
      ]
    }
    const ticks = () => document.querySelectorAll('[data-sheet-item] svg').length
    const render = (provider: string) =>
      paint(
        createElement(ModelSheet, {
          open: true,
          onClose: () => {},
          current: { provider, model: 'claude-fable-5' },
          onLoad: () => Promise.resolve(collision),
          onPick: () => {}
        })
      )

    // Unseeded chip: the tail is ambiguous, so neither row is claimed.
    render('')
    await settle()
    expect(ticks()).toBe(0)

    // A known provider ticks exactly the row it names.
    render('openrouter')
    await settle()
    expect(ticks()).toBe(1)
    expect(document.querySelector('[data-sheet-item="openrouter/claude-fable-5"] svg')).not.toBeNull()
  })

  it('separates the toggle from the efforts under their own label', async () => {
    paint(
      createElement(ReasoningSheet, {
        open: true,
        onClose: () => {},
        value: 'high',
        onChange: () => {},
        onLoad: () => Promise.resolve('high'),
        onPick: () => Promise.resolve()
      })
    )
    await settle()

    const panel = document.querySelector('[data-sheet="reasoning"]') as HTMLElement
    expect(panel.querySelector('[data-thinking-toggle]')).not.toBeNull()
    // No title text and no close button here either.
    expect(panel.querySelector('[aria-label="Close"]')).toBeNull()
    // One rule, between the toggle row and the labelled list.
    expect(panel.querySelectorAll('.border-t').length).toBeGreaterThanOrEqual(1)
    expect(panel.querySelector('h2')?.textContent).toBe('Reasoning efforts')
    const rows = [...panel.querySelectorAll('[data-reasoning-row]')].map(node => node.getAttribute('data-reasoning-row'))
    expect(rows[rows.length - 1]).toBe('ultra')
    // The old footer note is gone: the toggle already says it.
    expect(panel.textContent).not.toContain('Thinking is off')
  })

  it('marks the live effort and applies a row pick', async () => {
    const picked: string[] = []
    const onClose = vi.fn()
    paint(
      createElement(ReasoningSheet, {
        open: true,
        onClose,
        value: 'high',
        onChange: () => {},
        onLoad: () => Promise.resolve('high'),
        onPick: (value: string) => {
          picked.push(value)
          return Promise.resolve()
        }
      })
    )
    await settle()

    const active = document.querySelector('[data-reasoning-row="high"]')
    expect(active?.querySelector('svg')).not.toBeNull()

    act(() => (document.querySelector('[data-reasoning-row="xhigh"]') as HTMLButtonElement).click())
    expect(picked).toEqual(['xhigh'])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reads the switch as off when the chat runs without thinking', async () => {
    paint(
      createElement(ReasoningSheet, {
        open: true,
        onClose: () => {},
        value: 'none',
        onChange: () => {},
        onLoad: () => Promise.resolve('none'),
        onPick: () => Promise.resolve()
      })
    )
    await settle()

    const toggle = document.querySelector('[data-thinking-toggle]') as HTMLButtonElement
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('writes the gateway off value from the thinking toggle', async () => {
    const picked: string[] = []
    paint(
      createElement(ReasoningSheet, {
        open: true,
        onClose: () => {},
        value: 'high',
        onChange: () => {},
        onLoad: () => Promise.resolve('high'),
        onPick: (value: string) => {
          picked.push(value)
          return Promise.resolve()
        }
      })
    )
    await settle()

    act(() => (document.querySelector('[data-thinking-toggle]') as HTMLButtonElement).click())
    expect(picked).toEqual(['none'])
  })
})
