import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { ApiError } from '../src/api/errors';
import { AuthProvider, useAuth } from '../src/features/auth/AuthProvider';
import { configureNotifications } from '../src/notifications/scheduler';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';

configureNotifications(); // how notifications look while the app is open

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // retry network blips / 5xx twice, but never retry a 4xx (it will fail the same way)
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

/** The routes the signed-in / signed-out user may see. Expo Router redirects automatically. */
function Gate() {
  const { status } = useAuth();
  const { colors, mode } = useTheme();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={status === 'signedIn'}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings" options={{ presentation: 'card' }} />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

/** Theme follows the user's saved setting (users/me/ -> theme). */
function Themed({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <ThemeProvider setting={user?.theme ?? 'SYSTEM'}>{children}</ThemeProvider>;
}

export default function RootLayout() {
  // Refetch (and so re-plan reminders) when the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
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
