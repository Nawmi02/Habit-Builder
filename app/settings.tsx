import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, describeError } from '../src/api';
import type { ThemeSetting } from '../src/api/types';
import { Button } from '../src/components/Button';
import { useAuth } from '../src/features/auth/AuthProvider';
import type { ReminderIntensity } from '../src/lib/reminders';
import { DEFAULT_PREFS, loadReminderPrefs, saveReminderPrefs, type ReminderPrefs } from '../src/notifications/prefs';
import { scheduleTestReminder } from '../src/notifications/scheduler';
import { syncReminders } from '../src/notifications/syncReminders';
import { useTheme } from '../src/theme/ThemeProvider';
import { radius, SCREEN_PADDING } from '../src/theme/tokens';

/**
 * Settings (prototype: Settings*, Notifications, Reminders, Appearance, Logout).
 * Owner: Member 3 (extend it; this version already covers sign-out, theme and reminder intensity).
 *  - theme + notifications switch are saved on the server: PATCH /users/me/
 *  - reminder intensity / streak alert are saved on the phone (backend has no field for them)
 */
const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: 'LIGHT', label: 'Light' },
  { value: 'DARK', label: 'Dark' },
  { value: 'SYSTEM', label: 'System' },
];

const INTENSITIES: { value: ReminderIntensity; title: string; text: string }[] = [
  { value: 'gentle', title: 'Gentle', text: 'One reminder at each habit’s time.' },
  { value: 'motivated', title: 'Motivated', text: 'Reminder, a midday nudge and an evening nudge.' },
  { value: 'intense', title: 'Intense 🔥', text: 'Duolingo-style: every 2 hours, getting more urgent, until you’re done.' },
];

export default function Settings() {
  const { colors } = useTheme();
  const { user, setUser, signOut } = useAuth();
  const router = useRouter();
  const [prefs, setPrefs] = useState<ReminderPrefs>(DEFAULT_PREFS);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    loadReminderPrefs().then(setPrefs);
  }, []);

  if (!user) return null;

  async function patchUser(patch: { theme?: ThemeSetting; notifications_enabled?: boolean }) {
    setError(null);
    try {
      const updated = await api.users.update(patch);
      setUser(updated);
      if (patch.notifications_enabled !== undefined) await syncReminders(updated);
    } catch (e) {
      setError(describeError(e));
    }
  }

  async function changePrefs(next: ReminderPrefs) {
    setPrefs(next);
    await saveReminderPrefs(next);
    if (user) syncReminders(user).catch(() => {});
  }

  function confirmSignOut() {
    Alert.alert('Log out?', 'You will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.body}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={{ color: colors.primary, fontWeight: '600', marginBottom: 8 }}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.ink }]}>Settings</Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.name, { color: colors.ink }]}>{user.name}</Text>
          <Text style={{ color: colors.muted }}>{user.email}</Text>
          <Text style={{ color: colors.faint, marginTop: 4, fontSize: 12 }}>Time zone: {user.time_zone}</Text>
        </View>

        {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}

        <Text style={[styles.section, { color: colors.muted }]}>APPEARANCE</Text>
        <View style={styles.row}>
          {THEMES.map((t) => (
            <Pressable
              key={t.value}
              onPress={() => patchUser({ theme: t.value })}
              style={[styles.option, { borderColor: user.theme === t.value ? colors.primary : colors.border, backgroundColor: user.theme === t.value ? colors.primaryTint : colors.card }]}
            >
              <Text style={{ color: colors.ink, fontWeight: '600' }}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.section, { color: colors.muted }]}>NOTIFICATIONS</Text>
        <View style={[styles.card, styles.switchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.ink, fontSize: 16, flex: 1 }}>Enable reminders</Text>
          <Switch value={user.notifications_enabled} onValueChange={(v) => patchUser({ notifications_enabled: v })} trackColor={{ true: colors.primary }} />
        </View>

        {user.notifications_enabled ? (
          <>
            <Text style={[styles.section, { color: colors.muted }]}>REMINDER INTENSITY</Text>
            {INTENSITIES.map((i) => (
              <Pressable
                key={i.value}
                onPress={() => changePrefs({ ...prefs, intensity: i.value })}
                style={[styles.card, { backgroundColor: prefs.intensity === i.value ? colors.primaryTint : colors.card, borderColor: prefs.intensity === i.value ? colors.primary : colors.border }]}
              >
                <Text style={{ color: colors.ink, fontWeight: '700', marginBottom: 2 }}>{i.title}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{i.text}</Text>
              </Pressable>
            ))}
            <View style={[styles.card, styles.switchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ color: colors.ink, fontSize: 16 }}>Streak at risk alert</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>At 8 pm if a streak of 3+ days is still unfinished.</Text>
              </View>
              <Switch value={prefs.streakAlert} onValueChange={(v) => changePrefs({ ...prefs, streakAlert: v })} trackColor={{ true: colors.primary }} />
            </View>
            <Button
              label="Send me a test reminder"
              variant="secondary"
              onPress={async () => {
                const ok = await scheduleTestReminder();
                setNote(ok ? 'Sent! Lock your phone - it arrives in 5 seconds.' : 'Notifications are blocked. Enable them in your phone settings.');
              }}
            />
            {note ? <Text style={{ color: colors.muted, marginTop: 8, textAlign: 'center' }}>{note}</Text> : null}
          </>
        ) : null}

        <View style={{ height: 24 }} />
        <Button label="Log out" variant="danger" onPress={confirmSignOut} />
        {/* TODO (Member 3): Profile edit, Delete account. The backend has NO delete-account or
            change-password endpoint yet - see the "backend asks" list before building those. */}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { padding: SCREEN_PADDING, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 16 },
  section: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginTop: 20, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: radius.card, padding: 16, marginBottom: 10 },
  name: { fontSize: 18, fontWeight: '700', marginBottom: 2 },
  row: { flexDirection: 'row', gap: 8 },
  option: { flex: 1, height: 48, borderRadius: radius.input, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
});
