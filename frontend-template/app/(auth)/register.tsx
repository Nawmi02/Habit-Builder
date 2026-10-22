import { Link } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, describeError } from '../../src/api';
import { Button } from '../../src/components/Button';
import { Field } from '../../src/components/Field';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { useTheme } from '../../src/theme/ThemeProvider';
import { SCREEN_PADDING } from '../../src/theme/tokens';

/** Prototype: Register. Owner: Member 1. Endpoint: POST /auth/register/ (returns user + tokens). */
export default function Register() {
  const { colors } = useTheme();
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = 'Enter your name.';
    if (!email.trim()) local.email = 'Enter your email.';
    if (password.length < 8) local.password = 'Use at least 8 characters.';
    else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      local.password = 'Use at least one letter and one number.';
    }
    setFieldErrors(local);
    setError(null);
    if (Object.keys(local).length) return;

    setBusy(true);
    try {
      // The phone's time zone decides what "today" means for the user's habits.
      const time_zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      await signUp({ name: name.trim(), email: email.trim(), password, time_zone });
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        // map DRF field errors onto the inputs; anything else goes in the general message
        const mapped: Record<string, string> = {};
        for (const key of ['name', 'email', 'password', 'time_zone']) {
          const msg = e.field(key);
          if (msg) mapped[key] = msg;
        }
        setFieldErrors(mapped);
        if (Object.keys(mapped).length === 0) setError(e.message);
      } else {
        setError(describeError(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: colors.ink }]}>Create account</Text>
          <Text style={[styles.sub, { color: colors.muted }]}>Build habits that stick.</Text>

          <Field label="Display name" value={name} onChangeText={setName} textContentType="name" placeholder="Alex Johnson" error={fieldErrors.name} />
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" error={fieldErrors.email} />
          <Field label="Password" value={password} onChangeText={setPassword} password autoCapitalize="none" textContentType="newPassword" placeholder="At least 8 characters, with a letter and number" error={fieldErrors.password} />
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: -10, marginBottom: 16 }}>
            At least 8 characters, including one letter and one number.
          </Text>
          {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}

          <Button label="Create account" onPress={submit} loading={busy} />

          <Text style={[styles.footer, { color: colors.muted }]}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: colors.primary, fontWeight: '700' }}>Sign in</Link>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { padding: SCREEN_PADDING, paddingTop: 40 },
  title: { fontSize: 28, fontWeight: '700' },
  sub: { marginTop: 6, marginBottom: 28 },
  footer: { textAlign: 'center', marginTop: 24 },
});
