import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from './http';

const ACCESS = 'hb.access';
const REFRESH = 'hb.refresh';

/**
 * Tokens live in the OS keychain/keystore (expo-secure-store) - never AsyncStorage.
 * The access token is cached in memory because it's read on every request.
 */
export function createSecureTokenStore(): TokenStore {
  let accessCache: string | null | undefined; // undefined = not loaded yet
  return {
    async getAccess() {
      if (accessCache === undefined) accessCache = await SecureStore.getItemAsync(ACCESS);
      return accessCache;
    },
    getRefresh: () => SecureStore.getItemAsync(REFRESH),
    async setTokens(t) {
      accessCache = t.access;
      await SecureStore.setItemAsync(ACCESS, t.access);
      if (t.refresh) await SecureStore.setItemAsync(REFRESH, t.refresh);
    },
    async clear() {
      accessCache = null;
      await Promise.all([SecureStore.deleteItemAsync(ACCESS), SecureStore.deleteItemAsync(REFRESH)]);
    },
  };
}
