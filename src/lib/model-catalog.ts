/** One provider row from `model.options`: the picker groups by these, and the
 *  virtual `moa` row is split out into its own preset section. */
export interface ModelOptionRow {
  slug: string
  name: string
  models: string[]
  is_current?: boolean
  authenticated?: boolean
  warning?: string
}

export interface ModelOptions {
  providers: ModelOptionRow[]
  model?: string
  provider?: string
}

/** The effort ladder, in the order the sheet lists it. `none` is the thinking
 *  toggle's off state, never a row. */
export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const

const EFFORT_TITLES: Record<string, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
  ultra: 'Ultra'
}

/** Everything the sheet renders, minus the preset row: a provider with no model
 *  listed contributes nothing to a picker. */
export function providerGroups(options: ModelOptions | null): ModelOptionRow[] {
  return (options?.providers ?? []).filter(row => row.slug !== 'moa' && row.models.length > 0)
}

/** The `moa` row's own model list IS the configured preset names. */
export function moaPresets(options: ModelOptions | null): { presets: string[]; warning: string } {
  const row = (options?.providers ?? []).find(entry => entry.slug === 'moa')
  return { presets: row?.models ?? [], warning: row?.warning ?? '' }
}

/** Search over provider names, provider slugs and model ids. A query that names
 *  a provider keeps that provider whole; otherwise the row keeps only its
 *  matching ids. */
export function filterGroups(groups: ModelOptionRow[], query: string): ModelOptionRow[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return groups
  const out: ModelOptionRow[] = []
  for (const group of groups) {
    if (group.name.toLowerCase().includes(needle) || group.slug.toLowerCase().includes(needle)) {
      out.push(group)
      continue
    }
    const models = group.models.filter(model => model.toLowerCase().includes(needle))
    if (models.length) out.push({ ...group, models })
  }
  return out
}

/** The id's tail after any `provider/` prefix: what the composer button shows. */
export function bareModel(model: string): string {
  const cut = model.lastIndexOf('/')
  return cut === -1 ? model : model.slice(cut + 1)
}

/** The chip's own copy: the desktop pill spells the virtual provider out as
 *  `moa: <preset>`, because a preset name on its own means nothing. */
export function modelLabel(provider: string, model: string): string {
  if (model && provider === 'moa') return `moa: ${model}`
  if (model) return bareModel(model)
  return provider || 'model'
}

/** Whether this effort means thinking is on. An empty value is `unknown` (the
 *  seed has not answered) and reads as on, so the chip never flashes `off` over
 *  a chat running at `medium`. */
export function reasoningEnabled(value: string): boolean {
  return value !== 'none' && value !== 'off' && value !== 'false' && value !== 'disabled'
}

export function reasoningLabel(value: string): string {
  if (!value) return 'reasoning'
  if (!reasoningEnabled(value)) return 'off'
  return EFFORT_TITLES[value] || value
}

/** The display value one effort row carries. */
export function effortTitle(value: string): string {
  return EFFORT_TITLES[value] || value.charAt(0).toUpperCase() + value.slice(1)
}

/** How a pick is applied: `--session` is deliberate for every mobile pick, so a
 *  chosen model never rewrites the profile default behind the phone. */
export function modelSwitchValue(provider: string, model: string): string {
  return `${model} --provider ${provider} --session`
}
