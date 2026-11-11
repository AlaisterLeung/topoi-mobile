import { gateway } from './gateway'
import { moaPresets, providerGroups, modelSwitchValue, type ModelOptions } from './model-catalog'

async function fetchModelOptions(sessionId: string, explicitOnly: boolean): Promise<ModelOptions> {
  return gateway.call<ModelOptions>('model.options', {
    explicit_only: explicitOnly,
    ...(sessionId ? { session_id: sessionId } : {})
  })
}

/** An explicit-only catalogue, the same view the desktop chat pickers show: only
 *  providers this profile has configured, plus the virtual moa row. A profile
 *  with nothing explicit falls back to the wider list, so the sheet is never
 *  empty on a gateway that holds no `model:` block. Always a fresh read: the
 *  caller decides whether it may paint. */
export async function loadModelOptions(sessionId: string): Promise<ModelOptions> {
  const options = await fetchModelOptions(sessionId, true)
  if (!providerGroups(options).length && !moaPresets(options).presets.length) {
    return fetchModelOptions(sessionId, false)
  }
  return options
}

export async function loadReasoningEffort(sessionId: string): Promise<string> {
  const answer = await gateway.call<{ value?: string }>('config.get', {
    key: 'reasoning',
    ...(sessionId ? { session_id: sessionId } : {})
  })
  /** The schema's own freshness call, not a mistake: `_cfg_get_reasoning` answers
   *  the effort when enabled and `none` when disabled, so the only unseeded case
   *  is an empty answer, which stays empty and reads as unknown on the chip. */
  return answer?.value || ''
}

/** Switch this chat's model. `false` means the gateway asked to confirm an
 *  expensive model and the user declined: nothing was applied. */
export async function pickModel(sessionId: string, provider: string, model: string): Promise<boolean> {
  const params = { key: 'model', value: modelSwitchValue(provider, model), session_id: sessionId }
  const answer = await gateway.call<{ confirm_message?: string; confirm_required?: boolean }>('config.set', params)
  if (!answer?.confirm_required) return true
  const go = window.confirm(answer.confirm_message || `Switch to ${model}? It is billed at a higher rate.`)
  if (!go) return false
  await gateway.call('config.set', { ...params, confirm_expensive_model: true })
  return true
}

/** `none` is the disabled state; `off` and `hide` are display words that would
 *  only hide the thinking text and leave the model thinking. */
export async function pickReasoningEffort(sessionId: string, value: string): Promise<void> {
  await gateway.call('config.set', { key: 'reasoning', value, session_id: sessionId })
}
