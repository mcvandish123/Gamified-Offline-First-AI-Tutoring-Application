import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Device from 'expo-device'

/**
 * Resolves the backend base URL for the current platform.
 *
 * - Web: assumes the backend runs on the same machine as the browser.
 * - Android emulator: 10.0.2.2 is a special alias the emulator provides
 *   to reach its host machine's localhost — always works, but ONLY
 *   inside the emulator's virtual network.
 * - iOS simulator: shares the host machine's network directly, so plain
 *   localhost works.
 * - A REAL physical device (Expo Go on an actual phone) is on its own
 *   network connection and can't reach "localhost" or "10.0.2.2" at
 *   all — those just point back at the phone itself, so requests hang
 *   indefinitely instead of failing fast. For real devices we instead
 *   read the LAN IP that Expo's dev server (Metro) reports itself as
 *   being hosted on via Constants.expoConfig.hostUri (e.g.
 *   "192.168.1.42:8081") and hit the backend on that same IP. This
 *   requires the phone and the machine running the backend to be on
 *   the same network/Wi-Fi, with the backend's port reachable (no
 *   firewall blocking it).
 */
const getBackendUrl = () => {
  if (Platform.OS === 'web') {
    return 'http://localhost:3000'
  }

  if (Device.isDevice) {
    const hostUri =
      Constants.expoConfig?.hostUri ??
      (Constants as any).expoGoConfig?.debuggerHost
    const host = hostUri?.split(':')[0]
    if (host) {
      return `http://${host}:3000`
    }
    // No dev-server host detected (e.g. a standalone production build
    // with no Metro attached) — fall through. In that case BACKEND_URL
    // needs to point at a real deployed backend instead of localhost.
  }

  return Platform.OS === 'android'
    ? 'http://10.0.2.2:3000'
    : 'http://localhost:3000'
}

export const BACKEND_URL = getBackendUrl().replace(/\/+$/, '')

// Temporary diagnostic log — check Metro's terminal output (or the
// browser console on web) to confirm exactly what address the app is
// trying to reach. Remove once networking is confirmed working.
console.log('[api] Resolved BACKEND_URL:', BACKEND_URL)
