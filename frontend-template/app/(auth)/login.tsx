import { Link } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, describeError } from '../../src/api';
import { Button } from '../../src/components/Button';
import { Field } from '../../src/components/Field';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { useTheme } from '../../src/theme/ThemeProvider';
import { SCREEN_PADDING } from '../../src/theme/tokens';

/** Prototype: Login. Owner: Member 1. Endpoint: POST /auth/login/ then GET /users/me/. */
export default function Login() {
  const { colors } = useTheme();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    setError(null);
    try {
      // NOTE: do not lowercase the email - Django only normalises the domain part.
      await signIn({ email: email.trim(), password });
      // no navigation needed: the root layout swaps to the tabs when status becomes signedIn
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'Incorrect email or password.' : describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={[styles.logo, { backgroundColor: colors.primary }]}>
            <Text style={{ fontSize: 34 }}>🔥</Text>
          </View>
          <Text style={[styles.title, { color: colors.ink }]}>Welcome back</Text>
          <Text style={[styles.sub, { color: colors.muted }]}>Sign in to keep your streak going.</Text>

          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" placeholder="you@example.com" />
          <Field label="Password" value={password} onChangeText={setPassword} password autoCapitalize="none" textContentType="password" placeholder="Your password" error={error ?? undefined} />

          <Button label="Sign in" onPress={submit} loading={busy} style={{ marginTop: 8 }} />

          <View style={styles.footer}>
            <Text style={{ color: colors.muted }}>New here? </Text>
            <Link href="/register" style={{ color: colors.primary, fontWeight: '700' }}>Create an account</Link>
          </View>
          {/* "Forgot password?" is in the prototype, but the backend has no reset endpoint yet. */}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { padding: SCREEN_PADDING, paddingTop: 48 },
  logo: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 20 },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  sub: { textAlign: 'center', marginTop: 6, marginBottom: 32 },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
});
