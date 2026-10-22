import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onAuthLost, tokens } from '../../api';
import { NetworkError } from '../../api/errors';
import type { LoginRequest, RegisterRequest, User } from '../../api/types';
import { cancelAllReminders, registerPushToken, unregisterPushToken } from '../../notifications/scheduler';
import { syncReminders } from '../../notifications/syncReminders';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  user: User | null;
  signIn: (req: LoginRequest) => Promise<void>;
  signUp: (req: RegisterRequest) => Promise<void>;
  signOut: () => Promise<void>;
  /** Replace the cached user after PATCH /users/me/ (theme, name, notifications...). */
  setUser: (user: User) => void;
}

const USER_CACHE = 'hb.user';
const Ctx = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<User | null>(null);

  const setUser = useCallback((u: User) => {
    setUserState(u);
    AsyncStorage.setItem(USER_CACHE, JSON.stringify(u)).catch(() => {});
  }, []);

  const enter = useCallback(
    (u: User) => {
      setUser(u);
      setStatus('signedIn');
      registerPushToken(); // fire and forget - never blocks or throws
      void syncReminders(u).catch((error) => {
        console.warn('Could not sync reminders:', error);
      });
    },
    [setUser],
  );

  const leave = useCallback(async () => {
    setUserState(null);
    setStatus('signedOut');
    queryClient.clear();
    await AsyncStorage.removeItem(USER_CACHE).catch(() => {});
  }, [queryClient]);

  // On launch: if we hold a refresh token, try to load the profile.
  useEffect(() => {
    let alive = true;
    (async () => {
      const refresh = await tokens.getRefresh();
      if (!refresh) {
        if (alive) setStatus('signedOut');
        return;
      }
      try {
        const me = await api.users.me(); // the http client refreshes the access token if needed
        if (alive) enter(me);
      } catch (e) {
        if (!alive) return;
        if (e instanceof NetworkError) {
          // Offline at launch: stay signed in using the last known profile.
          const cached = await AsyncStorage.getItem(USER_CACHE).catch(() => null);
          if (cached) {
            setUserState(JSON.parse(cached) as User);
            setStatus('signedIn');
          } else {
            setStatus('signedOut');
          }
        } else {
          setStatus('signedOut');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [enter]);

  // The refresh token was rejected somewhere deep in a request -> back to the login screen.
  useEffect(() => onAuthLost(() => void leave()), [leave]);

  const signIn = useCallback(
    async (req: LoginRequest) => {
      const t = await api.auth.login(req); // login returns tokens only...
      await tokens.setTokens(t);
      enter(await api.users.me()); // ...so fetch the profile
    },
    [enter],
  );

  const signUp = useCallback(
    async (req: RegisterRequest) => {
      const res = await api.auth.register(req); // register returns { user, access, refresh }
      await tokens.setTokens({ access: res.access, refresh: res.refresh });
      enter(res.user);
    },
    [enter],
  );

  /**
   * There is NO server logout endpoint (token blacklisting isn't installed), so signing out
   * is local: stop pushes, drop scheduled reminders, delete tokens.
   */
  const signOut = useCallback(async () => {
    await unregisterPushToken();
    await cancelAllReminders().catch(() => {});
    await tokens.clear().catch(() => {});
    await leave();
  }, [leave]);

  const value = useMemo(() => ({ status, user, signIn, signUp, signOut, setUser }), [status, user, signIn, signUp, signOut, setUser]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
