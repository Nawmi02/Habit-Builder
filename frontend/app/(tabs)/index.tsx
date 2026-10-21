import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, describeError } from '../../src/api';
import type { ChecklistItem } from '../../src/api/types';
import { Button } from '../../src/components/Button';
import { CompletionSheet, type CheckInRequest } from '../../src/components/CompletionSheet';
import { HabitTile } from '../../src/components/HabitTile';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { performCheckIn } from '../../src/features/home/checkIn';
import { flattenChecklist, greeting, progressOf } from '../../src/lib/checklist';
import { syncReminders } from '../../src/notifications/syncReminders';
import { useTheme } from '../../src/theme/ThemeProvider';
import { SCREEN_PADDING } from '../../src/theme/tokens';

/**
 * Daily checklist (prototype: HomeDashboard). Owner: Member 1.
 * Backed by GET /habits/checklist/ and POST /occurrences/{id}/complete|skip/.
 */
export default function Home() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  const [open, setOpen] = useState<ChecklistItem | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const checklist = useQuery({ queryKey: ['checklist'], queryFn: () => api.habits.checklist() });
  const items = useMemo(() => flattenChecklist(checklist.data), [checklist.data]);
  const progress = progressOf(checklist.data?.summary);

  const checkIn = useMutation({
    mutationFn: (req: CheckInRequest) => performCheckIn(req, qc),
    onSuccess: (unlocked, req) => {
      setOpen(null);
      setSheetError(null);
      setToast(req.intent === 'skip' ? 'Habit skipped' : req.intent === 'slip' ? 'Logged. Tomorrow is a new day 💜' : 'Nice work! 🎉');
      qc.invalidateQueries({ queryKey: ['checklist'] });
      qc.invalidateQueries({ queryKey: ['points'] });
      if (unlocked.length) {
        // TODO (Member 3): replace with the full-screen Badge Unlock celebration from the prototype.
        Alert.alert('🏆 New badge unlocked!', unlocked.map((b) => `${b.name}: ${b.description}`).join('\n'));
      }
    },
    onError: (e) => {
      setSheetError(describeError(e));
      // The row may have changed on another device ("Only pending occurrences can be completed").
      qc.invalidateQueries({ queryKey: ['checklist'] });
    },
  });

  // auto-hide the toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Re-plan the local reminders whenever the checklist data changes (debounced). Finishing your
  // last habit therefore cancels the rest of today's nagging.
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!user || !checklist.data) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      syncReminders(user).catch(() => {});
    }, 1500);
    return () => clearTimeout(syncTimer.current);
  }, [user, checklist.dataUpdatedAt, checklist.data]);

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <FlatList
        data={items}
        keyExtractor={(i) => String(i.occurrence_id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={checklist.isRefetching} onRefresh={() => checklist.refetch()} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.topRow}>
              <Text style={[styles.date, { color: colors.muted }]}>{dateLabel}</Text>
              <Pressable onPress={() => router.push('/settings')} accessibilityLabel="Settings" hitSlop={12}>
                <Text style={{ fontSize: 22 }}>⚙️</Text>
              </Pressable>
            </View>
            <Text style={[styles.greeting, { color: colors.ink }]}>{greeting(new Date())}{user ? `, ${user.name.split(' ')[0]}` : ''}</Text>
            <View style={styles.progressRow}>
              <Text style={{ color: colors.muted }}>
                {progress.done} of {progress.total} done
              </Text>
            </View>
            <View style={[styles.bar, { backgroundColor: colors.border }]}>
              <View style={[styles.barFill, { backgroundColor: colors.primary, width: `${Math.round(progress.fraction * 100)}%` }]} />
            </View>
            {progress.total > 0 && progress.done === progress.total ? (
              <View style={[styles.banner, { backgroundColor: colors.primaryTint }]}>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>All habits done! Great work today 🎉</Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <HabitTile
            item={item}
            onPress={(i) => {
              setSheetError(null);
              setOpen(i);
            }}
          />
        )}
        ListEmptyComponent={
          checklist.isLoading ? (
            <Text style={[styles.center, { color: colors.muted }]}>Loading your habits…</Text>
          ) : checklist.isError ? (
            <View style={styles.centerBox}>
              <Text style={[styles.center, { color: colors.danger }]}>{describeError(checklist.error)}</Text>
              <Button label="Try again" variant="secondary" onPress={() => checklist.refetch()} />
            </View>
          ) : (
            <View style={styles.centerBox}>
              <Text style={[styles.emptyTitle, { color: colors.ink }]}>No habits yet</Text>
              <Text style={[styles.center, { color: colors.muted }]}>Add your first habit to start your streak.</Text>
              <Button label="Add a habit" onPress={() => router.push('/habits')} />
            </View>
          )
        }
      />

      <CompletionSheet
        item={open}
        busy={checkIn.isPending}
        error={sheetError}
        onClose={() => {
          if (!checkIn.isPending) setOpen(null);
        }}
        onSubmit={(req) => {
          setSheetError(null);
          checkIn.mutate(req);
        }}
      />

      {toast ? (
        <View style={[styles.toast, { backgroundColor: colors.ink }]} pointerEvents="none">
          <Text style={{ color: colors.bg, fontWeight: '600' }}>{toast}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingHorizontal: SCREEN_PADDING, paddingBottom: 40 },
  header: { paddingTop: 8, paddingBottom: 16 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: 14, fontWeight: '600' },
  greeting: { fontSize: 26, fontWeight: '700', marginTop: 6, marginBottom: 14 },
  progressRow: { flexDirection: 'row', marginBottom: 8 },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  banner: { marginTop: 14, padding: 14, borderRadius: 12 },
  center: { textAlign: 'center', marginVertical: 8 },
  centerBox: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  toast: { position: 'absolute', bottom: 28, alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 24 },
});
