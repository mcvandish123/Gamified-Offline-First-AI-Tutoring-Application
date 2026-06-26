/**
 * Web shim for expo-secure-store.
 * expo-secure-store uses iOS Keychain / Android Keystore — neither exists
 * in a browser. On web we fall back to localStorage, which is fine for
 * development and acceptable for a web build (not truly "secure" but
 * functionally equivalent for token storage in a browser context).
 */

export async function setItemAsync(key, value) {
  localStorage.setItem(key, value);
}

export async function getItemAsync(key) {
  return localStorage.getItem(key);
}

export async function deleteItemAsync(key) {
  localStorage.removeItem(key);
}

export default { setItemAsync, getItemAsync, deleteItemAsync };
