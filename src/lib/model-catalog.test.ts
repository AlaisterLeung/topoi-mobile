import { describe, expect, it } from 'vitest'

import {
  bareModel,
  effortTitle,
  filterGroups,
  moaPresets,
  modelLabel,
  modelSwitchValue,
  providerGroups,
  reasoningEnabled,
  reasoningLabel,
  type ModelOptions
} from './model-catalog'

const options: ModelOptions = {
  model: 'deepseek-v4.1-flash',
  provider: 'opencode-go',
  providers: [
    { slug: 'nous', name: 'Nous Portal', models: ['anthropic/claude-fable-5', 'deepseek/deepseek-v4'] },
    { slug: 'moa', name: 'Mixture of Agents', models: ['default', 'cheap'], warning: 'references only advise' },
    { slug: 'empty', name: 'Nothing Here', models: [] }
  ]
}

describe('model catalogue helpers', () => {
  it('groups providers and splits the moa row out', () => {
    expect(providerGroups(options).map(row => row.slug)).toEqual(['nous'])
    expect(moaPresets(options)).toEqual({ presets: ['default', 'cheap'], warning: 'references only advise' })
    expect(moaPresets(null).presets).toEqual([])
  })

  it('filters on model ids, provider names and provider slugs', () => {
    const groups = providerGroups(options)
    expect(filterGroups(groups, 'fable')[0].models).toEqual(['anthropic/claude-fable-5'])
    expect(filterGroups(groups, ' nous ')[0].models).toEqual(options.providers[0].models)
    expect(filterGroups(groups, 'portal')[0].models).toEqual(options.providers[0].models)
    expect(filterGroups(groups, 'nothing at all')).toEqual([])
    expect(filterGroups(groups, '')).toEqual(groups)
  })

  it('shows the id tail and never the provider prefix', () => {
    expect(bareModel('anthropic/claude-fable-5')).toBe('claude-fable-5')
    expect(bareModel('deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
    expect(modelLabel('opencode-go', 'deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
    expect(modelLabel('opencode-go', '')).toBe('opencode-go')
    expect(modelLabel('', '')).toBe('model')
  })

  it('names the moa preset and its provider', () => {
    expect(modelLabel('moa', 'default')).toBe('moa: default')
  })

  it('labels the effort and the off state', () => {
    expect(reasoningLabel('high')).toBe('High')
    expect(reasoningLabel('none')).toBe('off')
    expect(reasoningLabel('')).toBe('reasoning')
    expect(reasoningEnabled('')).toBe(true)
    expect(reasoningEnabled('none')).toBe(false)
    expect(effortTitle('xhigh')).toBe('XHigh')
    expect(effortTitle('ultra')).toBe('Ultra')
  })

  it('applies a pick to this session only', () => {
    expect(modelSwitchValue('moa', 'default')).toBe('default --provider moa --session')
  })
})
