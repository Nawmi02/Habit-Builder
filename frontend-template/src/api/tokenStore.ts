import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { TokenStore } from './http';

const ACCESS = 'hb.access';
const REFRESH = 'hb.refresh';

/**
 * Native tokens live in the OS keychain/keystore. Expo SecureStore does not provide
 * its native methods on web, so web uses AsyncStorage (browser storage) instead.
 * The access token is cached in memory because it's read on every request.
 */
export function createSecureTokenStore(): TokenStore {
  let accessCache: string | null | undefined; // undefined = not loaded yet
  const getItem = (key: string) =>
    Platform.OS === 'web' ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key);
  const setItem = (key: string, value: string) =>
    Platform.OS === 'web' ? AsyncStorage.setItem(key, value) : SecureStore.setItemAsync(key, value);
  const deleteItem = (key: string) =>
    Platform.OS === 'web' ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key);

  return {
    async getAccess() {
      if (accessCache === undefined) accessCache = await getItem(ACCESS);
      return accessCache;
    },
    getRefresh: () => getItem(REFRESH),
    async setTokens(t) {
      accessCache = t.access;
      await setItem(ACCESS, t.access);
      if (t.refresh) await setItem(REFRESH, t.refresh);
    },
    async clear() {
      accessCache = null;
      await Promise.all([deleteItem(ACCESS), deleteItem(REFRESH)]);
    },
  };
}
