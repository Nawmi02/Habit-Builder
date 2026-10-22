/** The app-wide API singleton. Screens import `api` from here. */
import { API_URL } from '../config';
import { createApi } from './endpoints';
import { createHttpClient } from './http';
import { createSecureTokenStore } from './tokenStore';

type Listener = () => void;
const listeners = new Set<Listener>();

/** Called when the refresh token is rejected (session truly over). AuthProvider listens. */
export function onAuthLost(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const tokens = createSecureTokenStore();
export const http = createHttpClient({
  baseUrl: API_URL,
  tokens,
  onAuthLost: () => listeners.forEach((fn) => fn()),
});
export const api = createApi(http);

export { ApiError, NetworkError, describeError } from './errors';
