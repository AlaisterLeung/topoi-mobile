import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.atxoft.topoi',
  appName: 'Topoi',
  webDir: 'dist',
  ios: {
    scheme: 'Topoi',
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
}

export default config
