import { Platform } from 'react-native'

/**
 * Resolves the backend base URL for the current platform.
 *
 * NOTE: We deliberately do NOT use Constants.expoConfig?.hostUri here.
 * On a real device that value is your machine's LAN IP, which is fine,
 * but on the Android emulator it is unreliable (often unreachable from
 * the emulator's sandboxed network) and overrides 10.0.2.2 — the
 * special alias Android emulators provide to reach the host machine,
 * which always works. Keep this simple.
 */
const getBackendUrl = () => {
  if (Platform.OS === 'web') {
    return 'http://localhost:3000'
  }
  return Platform.OS === 'android'
    ? 'http://10.0.2.2:3000'
    : 'http://localhost:3000'
}

export const BACKEND_URL = getBackendUrl()
