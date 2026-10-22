import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  AppState,
  View,
} from 'react-native';

import { ApiError } from '../src/api/errors';
import { AuthProvider, useAuth } from '../src/features/auth/AuthProvider';
import { configureNotifications } from '../src/notifications/scheduler';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';

// Configure how notifications behave while the app is open.
configureNotifications();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,

      // Retry transient network/5xx errors, but do not retry 4xx responses.
      retry: (count, error) =>
        !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

/**
 * Restricts the available routes based on authentication status.
 *
 * Signed-in users:
 *   - (tabs)
 *   - settings
 *
 * Signed-out users:
 *   - (auth)
 */
function Gate() {
  const { status } = useAuth();
  const { colors, mode } = useTheme();

  if (status === 'loading') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg,
        }}
      >
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <>
      <StatusBar
        style={mode === 'dark' ? 'light' : 'dark'}
      />

      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={status === 'signedIn'}>
          {/* The four bottom tabs live inside this navigator. */}
          <Stack.Screen name="(tabs)" />

          {/* Settings is a separate root-level screen, not a tab. */}
          <Stack.Screen
            name="settings"
            options={{
              headerShown: false,
              presentation: 'card',
            }}
          />
        </Stack.Protected>

        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

/**
 * The saved user theme controls the ThemeProvider.
 * Settings changes user.theme through the existing API, then updates
 * the authenticated user through setUser().
 */
function Themed({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  return (
    <ThemeProvider setting={user?.theme ?? 'SYSTEM'}>
      {children}
    </ThemeProvider>
  );
}

export default function RootLayout() {
  // Update React Query focus state when the app enters/leaves the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });

    return () => subscription.remove();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Themed>
          <Gate />
        </Themed>
      </AuthProvider>
    </QueryClientProvider>
  );
}
