import { registerPlugin } from '@capacitor/core'

import type { AuthSessionPlugin } from './definitions'

const TopoiAuthSession = registerPlugin<AuthSessionPlugin>('TopoiAuthSession')

export { TopoiAuthSession }
export type { AuthSessionPlugin, StartOptions, StartResult } from './definitions'
