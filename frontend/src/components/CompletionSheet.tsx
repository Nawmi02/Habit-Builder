import { useQuery } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../api';
import { tint, type CheckInIntent, type UiMood } from '../api/mappers';
import type { ChecklistItem } from '../api/types';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

export interface CheckInRequest {
  item: ChecklistItem;
  intent: CheckInIntent;
  progress?: number;
  mood?: UiMood;
  note?: string;
  skipReasonId?: number;
}

interface Props {
  item: ChecklistItem | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (req: CheckInRequest) => void;
}

const MOODS: { mood: UiMood; emoji: string }[] = [
  { mood: 'Great', emoji: '😄' },
  { mood: 'Good', emoji: '🙂' },
  { mood: 'Okay', emoji: '😐' },
  { mood: 'Bad', emoji: '😕' },
  { mood: 'Awful', emoji: '😩' },
];

/**
 * The prototype's completion bottom sheet, backed by the real rules:
 *  - YES_NO: one tap.  COUNT / DURATION: backend REJECTS a check-in below the target, so the
 *    button stays disabled until the stepper reaches it.
 *  - GOOD habit skip needs a reason (GET /skip-reasons/).  BAD habits are inverted: the main
 *    action is "I resisted" (calls /skip/, no reason) and "I slipped" calls /complete/.
 */
export function CompletionSheet({ item, busy, error, onClose, onSubmit }: Props) {
  const { colors } = useTheme();
  const [view, setView] = useState<'main' | 'skip'>('main');
  const [progress, setProgress] = useState(0);
  const [mood, setMood] = useState<UiMood | undefined>();
  const [note, setNote] = useState('');
  const [reasonId, setReasonId] = useState<number | null>(null);

  // fresh state every time a different habit is opened
  useEffect(() => {
    setView('main');
    setProgress(0);
    setMood(undefined);
    setNote('');
    setReasonId(null);
  }, [item?.occurrence_id]);

  const reasons = useQuery({
    queryKey: ['skipReasons'],
    queryFn: api.skipReasons.list,
    enabled: view === 'skip' && !!item,
    staleTime: Infinity,
  });

  if (!item) return <Modal visible={false} transparent />;

  const bad = item.habit_type === 'BAD';
  const stepper = !bad && item.target_type !== 'YES_NO';
  const step = item.target_type === 'DURATION' ? 5 : 1;
  const unit = item.target_unit || (item.target_type === 'DURATION' ? 'min' : 'times');
  const reached = !stepper || progress >= item.target_value;
  const cleanNote = note.trim() || undefined;

  const submit = (intent: CheckInIntent) =>
    onSubmit({ item, intent, progress: stepper && intent === 'success' ? progress : undefined, mood: bad ? undefined : mood, note: cleanNote, skipReasonId: reasonId ?? undefined });

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={styles.header}>
              <View style={[styles.icon, { backgroundColor: tint(item.color) }]}>
                <Text style={{ fontSize: 26 }}>{item.icon || '✅'}</Text>
              </View>
              <Text style={[styles.title, { color: colors.ink }]}>{item.name}</Text>
            </View>

            {error ? <Text style={[styles.error, { color: colors.danger, backgroundColor: tint(colors.danger, 0.1) }]}>{error}</Text> : null}

            {view === 'skip' ? (
              <View>
                <Text style={[styles.section, { color: colors.ink }]}>Why are you skipping?</Text>
                {reasons.isLoading ? <Text style={{ color: colors.muted }}>Loading…</Text> : null}
                {reasons.isError ? <Text style={{ color: colors.danger }}>Could not load reasons. Go back and try again.</Text> : null}
                <View style={styles.chips}>
                  {(reasons.data ?? []).filter((r) => r.is_active).map((r) => (
                    <Pressable
                      key={r.reason_id}
                      onPress={() => setReasonId(r.reason_id)}
                      style={[styles.chip, { borderColor: reasonId === r.reason_id ? colors.primary : colors.border, backgroundColor: reasonId === r.reason_id ? colors.primaryTint : colors.surface }]}
                    >
                      <Text style={{ color: colors.ink }}>{r.name}</Text>
                    </Pressable>
                  ))}
                </View>
                <Button label="Skip habit" variant="danger" loading={busy} disabled={reasonId === null} onPress={() => submit('skip')} style={styles.gap} />
                <Button label="Back" variant="ghost" onPress={() => setView('main')} />
              </View>
            ) : bad ? (
              <View>
                <Text style={[styles.hint, { color: colors.muted }]}>How did today go?</Text>
                <Button label="I resisted 💪" loading={busy} onPress={() => submit('success')} />
                <Button label="I slipped" variant="secondary" disabled={busy} onPress={() => submit('slip')} style={styles.gap} />
              </View>
            ) : (
              <View>
                {stepper ? (
                  <View style={styles.stepperBox}>
                    <View style={styles.stepperRow}>
                      <Pressable style={[styles.stepBtn, { backgroundColor: colors.surface }]} onPress={() => setProgress((p) => Math.max(0, p - step))} accessibilityLabel="Decrease">
                        <Text style={[styles.stepText, { color: colors.ink }]}>−</Text>
                      </Pressable>
                      <Text style={[styles.count, { color: colors.primary }]}>{progress}</Text>
                      <Pressable style={[styles.stepBtn, { backgroundColor: colors.surface }]} onPress={() => setProgress((p) => p + step)} accessibilityLabel="Increase">
                        <Text style={[styles.stepText, { color: colors.ink }]}>+</Text>
                      </Pressable>
                    </View>
                    <Text style={{ color: colors.muted, marginTop: 6 }}>
                      {progress} of {item.target_value} {unit}
                    </Text>
                  </View>
                ) : null}

                <Text style={[styles.section, { color: colors.ink }]}>How do you feel?</Text>
                <View style={styles.moods}>
                  {MOODS.map((m) => (
                    <Pressable
                      key={m.mood}
                      onPress={() => setMood(mood === m.mood ? undefined : m.mood)}
                      accessibilityLabel={m.mood}
                      style={[styles.mood, { borderColor: mood === m.mood ? colors.primary : colors.border, backgroundColor: mood === m.mood ? colors.primaryTint : colors.surface }]}
                    >
                      <Text style={{ fontSize: 22 }}>{m.emoji}</Text>
                    </Pressable>
                  ))}
                </View>

                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Add a note (optional)"
                  placeholderTextColor={colors.faint}
                  style={[styles.note, { color: colors.ink, borderColor: colors.border, backgroundColor: colors.surface }]}
                  maxLength={200}
                />

                <Button label="Mark as done" loading={busy} disabled={!reached} onPress={() => submit('success')} />
                <Button label="Skip today" variant="ghost" disabled={busy} onPress={() => setView('skip')} />
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, maxHeight: '88%' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 14 },
  header: { alignItems: 'center', marginBottom: 16 },
  icon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  error: { padding: 12, borderRadius: radius.input, marginBottom: 12, overflow: 'hidden' },
  section: { fontSize: 14, fontWeight: '600', marginBottom: 10, marginTop: 4 },
  hint: { textAlign: 'center', marginBottom: 14 },
  gap: { marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1 },
  stepperBox: { alignItems: 'center', marginBottom: 14 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  stepBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 26, fontWeight: '600' },
  count: { fontSize: 44, fontWeight: '700', minWidth: 80, textAlign: 'center' },
  moods: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  mood: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  note: { height: 46, borderRadius: radius.input, borderWidth: 1, paddingHorizontal: 14, marginBottom: 16 },
});
