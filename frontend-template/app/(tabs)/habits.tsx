import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, describeError } from '../../src/api';
import type { Habit } from '../../src/api/types';
import { HABIT_COLORS, draftToHabitWrite, habitToDraft, tint, type HabitDraft } from '../../src/api/mappers';
import { Button } from '../../src/components/Button';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, SCREEN_PADDING } from '../../src/theme/tokens';
import { toDateString } from '../../src/lib/dates';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { syncReminders } from '../../src/notifications/syncReminders';

const EMOJIS = ['💧', '🏃', '📖', '🧘', '🏋️', '🥗', '😴', '✍️', '🎯', '🚭', '🧠', '🚶', '🧹', '💊', '📵', '🎸', '🌱', '☀️', '🦷', '🍎'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMPTY_DRAFT: HabitDraft = {
  name: '', emoji: '💧', colorKey: 'purple', habitType: 'build', targetType: 'count',
  durationEnabled: false, targetCount: 1, targetDuration: 10, frequency: 'daily', customDays: [],
  reminderEnabled: true, reminderTimes: ['08:00'], reminderTone: 'DEFAULT', timeOfDay: 'Morning',
};

function Header({ title, subtitle, onBack, action }: { title: string; subtitle?: string; onBack?: () => void; action?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      {onBack ? <Pressable onPress={onBack} hitSlop={12} style={styles.back}><Text style={{ color: colors.primary, fontSize: 25 }}>‹</Text></Pressable> : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.heading, { color: colors.ink }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

function Pill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable onPress={onPress} style={[styles.pill, { backgroundColor: selected ? colors.primaryTint : colors.card, borderColor: selected ? colors.primary : colors.border }]}><Text style={{ fontSize: 13, fontWeight: '600', color: selected ? colors.primary : colors.muted }}>{label}</Text></Pressable>;
}

function HabitRow({ habit, onOpen, onToggle, onDelete }: { habit: Habit; onOpen: () => void; onToggle: () => void; onDelete: () => void }) {
  const { colors } = useTheme();
  const paused = habit.status === 'PAUSED';
  const hex = habit.color || '#A78BFA';
  return (
    <View style={[styles.habitCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${habit.name}`} style={styles.habitMain}>
        <View style={[styles.habitEmoji, { backgroundColor: tint(hex, 0.2) }]}><Text style={{ fontSize: 24 }}>{habit.icon || '✅'}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.habitName, { color: colors.ink }]}>{habit.name}</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{habit.habit_type === 'GOOD' ? 'Build a habit' : 'Break a habit'} · {habit.time_of_day.toLowerCase()}</Text>
          <View style={[styles.statusPill, { backgroundColor: paused ? colors.surface : colors.primaryTint }]}><Text style={{ color: paused ? colors.muted : colors.primary, fontSize: 10, fontWeight: '700' }}>{paused ? 'PAUSED' : 'ACTIVE'}</Text></View>
        </View>
        <Text style={{ color: colors.faint, fontSize: 24, marginLeft: 6 }}>›</Text>
      </Pressable>
      <View style={[styles.rowActions, { borderTopColor: colors.border }]}>
        <Pressable onPress={onToggle} style={styles.rowAction}><Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>{paused ? '▶ Resume' : 'Ⅱ Pause'}</Text></Pressable>
        <View style={{ width: 1, height: 18, backgroundColor: colors.border }} />
        <Pressable onPress={onDelete} style={styles.rowAction}><Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>Delete</Text></Pressable>
      </View>
    </View>
  );
}

export default function Habits() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const qc = useQueryClient();
  const habitsQuery = useQuery({ queryKey: ['habits'], queryFn: () => api.habits.list() });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorStep, setEditorStep] = useState<1 | 2 | 3>(1);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [selected, setSelected] = useState<Habit | null>(null);
  const [draft, setDraft] = useState<HabitDraft>({ ...EMPTY_DRAFT });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'All' | 'Active' | 'Paused'>('All');

  const allHabits = habitsQuery.data ?? [];
  const shownHabits = useMemo(() => allHabits.filter((h) => filter === 'All' || (filter === 'Active' ? h.status === 'ACTIVE' : h.status === 'PAUSED')), [allHabits, filter]);
  const activeCount = allHabits.filter((h) => h.status === 'ACTIVE').length;
  const pausedCount = allHabits.filter((h) => h.status === 'PAUSED').length;

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['habits'] }),
      qc.invalidateQueries({ queryKey: ['checklist'] }),
      qc.invalidateQueries({ queryKey: ['analytics'] }),
    ]);
  };

  const toggleStatus = useMutation({
    mutationFn: async (habit: Habit) => habit.status === 'PAUSED' ? api.habits.resume(habit.habit_id) : api.habits.pause(habit.habit_id),
    onSuccess: (updated, habit) => {
      if (selected?.habit_id === habit.habit_id) setSelected(updated);
      void refresh();
      if (user) void syncReminders(user).catch(() => {});
    },
  });
  const removeHabit = useMutation({
    mutationFn: (id: number) => api.habits.remove(id),
    onSuccess: () => {
      void refresh();
      if (user) void syncReminders(user).catch(() => {});
    },
    onError: (error) => {
      const text = describeError(error);
      if (Platform.OS === 'web') window.alert(`Could not delete habit\n\n${text}`);
      else Alert.alert('Could not delete habit', text);
    },
  });

  function askDelete(habit: Habit) {
    const message = `“${habit.name}” will be removed from your habits.`;
    const remove = () => { setSelected(null); removeHabit.mutate(habit.habit_id); };
    // Alert.alert shows nothing in a web browser (react-native-web), so the Delete
    // button never got its confirmation there. Use the browser's own dialog on web.
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete habit?\n\n${message}`)) remove();
      return;
    }
    Alert.alert('Delete habit?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: remove },
    ]);
  }

  function createHabit() {
    setEditing(null); setSelected(null); setDraft({ ...EMPTY_DRAFT, customDays: [] }); setEditorStep(1); setFormError(null); setEditorOpen(true);
  }
  function editHabit(habit: Habit) {
    setSelected(null); setEditing(habit); setDraft(habitToDraft(habit)); setEditorStep(1); setFormError(null); setEditorOpen(true);
  }
  function updateDraft<K extends keyof HabitDraft>(key: K, value: HabitDraft[K]) {
    setDraft((old) => ({ ...old, [key]: value }));
  }
  function setTargetCount(value: string) {
    const targetCount = Math.min(999, Math.max(0, Number.parseInt(value, 10) || 0));
    setDraft((old) => ({
      ...old,
      targetCount,
      reminderTimes: Array.from({ length: targetCount }, (_, i) => old.reminderTimes[i] ?? '08:00'),
    }));
  }
  function setReminderTime(index: number, value: string) {
    setDraft((old) => ({
      ...old,
      reminderTimes: Array.from(
        { length: old.targetType === 'count' ? old.targetCount : 1 },
        (_, i) => i === index ? value : (old.reminderTimes[i] ?? '08:00'),
      ),
    }));
  }
  function setReminderEnabled(enabled: boolean) {
    setDraft((old) => ({
      ...old,
      reminderEnabled: enabled,
      reminderTimes: Array.from(
        { length: old.targetType === 'count' ? old.targetCount : 1 },
        (_, i) => old.reminderTimes[i] ?? '08:00',
      ),
    }));
  }
  function advanceEditor() {
    if (editorStep === 1 && !draft.name.trim()) { setFormError('Give your habit a name first.'); return; }
    if (editorStep === 2 && draft.targetType === 'count' && draft.targetCount < 1) { setFormError('Count target must be at least 1.'); return; }
    if (editorStep === 2 && draft.frequency === 'custom' && draft.customDays.length === 0) { setFormError('Choose at least one day.'); return; }
    setFormError(null);
    setEditorStep((editorStep + 1) as 2 | 3);
  }

  async function saveHabit() {
    if (!draft.name.trim()) { setFormError('Give your habit a name first.'); setEditorStep(1); return; }
    if (draft.frequency === 'custom' && draft.customDays.length === 0) { setFormError('Choose at least one day.'); setEditorStep(2); return; }
    if (draft.reminderEnabled && (draft.reminderTimes.length !== (draft.targetType === 'count' ? draft.targetCount : 1) || draft.reminderTimes.some((time) => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)))) { setFormError('Enter a valid 24-hour reminder time for each count.'); setEditorStep(3); return; }
    setSaving(true); setFormError(null);
    try {
      const startDate = editing?.start_date ?? toDateString(new Date());
      const payload = draftToHabitWrite({ ...draft, name: draft.name.trim() }, startDate);
      if (editing) await api.habits.update(editing.habit_id, payload);
      else await api.habits.create(payload);
      if (user) void syncReminders(user).catch(() => {});
      await refresh(); setEditorOpen(false); setEditing(null);
    } catch (e) { setFormError(describeError(e)); }
    finally { setSaving(false); }
  }

  const DetailModal = selected ? (
    <HabitDetailModal habit={selected} onClose={() => setSelected(null)} onEdit={() => editHabit(selected)} onToggle={() => toggleStatus.mutate(selected)} onDelete={() => askDelete(selected)} busy={toggleStatus.isPending || removeHabit.isPending} />
  ) : null;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top']}>
      <Header title="My Habits" subtitle="Small routines, lasting change" action={<Pressable onPress={createHabit} accessibilityLabel="Create habit" style={[styles.addButton, { backgroundColor: colors.primaryTint }]}><Text style={{ color: colors.primary, fontSize: 25, lineHeight: 28 }}>＋</Text></Pressable>} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.summaryCard, { backgroundColor: colors.primary }]}>
          <View style={{ flex: 1 }}><Text style={{ color: '#EDE9FE', fontSize: 12, fontWeight: '600' }}>YOUR ROUTINE</Text><Text style={{ color: '#FFFFFF', fontSize: 21, fontWeight: '800', marginTop: 4 }}>{activeCount} active habit{activeCount === 1 ? '' : 's'}</Text><Text style={{ color: '#EDE9FE', fontSize: 12, marginTop: 5 }}>{pausedCount ? `${pausedCount} paused · ` : ''}Keep showing up, one day at a time.</Text></View>
          <View style={styles.summaryGlyph}><Text style={{ fontSize: 29 }}>✨</Text></View>
        </View>
        <View style={styles.filterRow}>{(['All', 'Active', 'Paused'] as const).map((f) => <Pill key={f} label={`${f}${f === 'Active' ? ` (${activeCount})` : f === 'Paused' ? ` (${pausedCount})` : ''}`} selected={filter === f} onPress={() => setFilter(f)} />)}</View>

        {habitsQuery.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.muted }}>Loading your habits…</Text></View> : null}
        {habitsQuery.isError ? <View style={[styles.notice, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={{ color: colors.danger, textAlign: 'center' }}>{describeError(habitsQuery.error)}</Text><Button label="Try again" variant="secondary" onPress={() => habitsQuery.refetch()} style={{ marginTop: 12 }} /></View> : null}
        {!habitsQuery.isLoading && !habitsQuery.isError && shownHabits.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.primaryTint }]}><Text style={{ fontSize: 32 }}>{filter === 'Paused' ? '⏸️' : '🌱'}</Text></View>
            <Text style={[styles.emptyTitle, { color: colors.ink }]}>{filter === 'Paused' ? 'No paused habits' : 'Start with one small habit'}</Text>
            <Text style={[styles.emptyCopy, { color: colors.muted }]}>{filter === 'Paused' ? 'Habits you pause will appear here.' : 'Build a routine around something you want to do more often.'}</Text>
            {filter !== 'Paused' ? <Button label="Create my first habit" onPress={createHabit} style={{ marginTop: 6, alignSelf: 'stretch' }} /> : null}
          </View>
        ) : null}

        {!habitsQuery.isLoading && !habitsQuery.isError && shownHabits.length > 0 ? <>
          <View style={styles.sectionHeading}><Text style={[styles.sectionTitle, { color: colors.ink }]}>{filter === 'All' ? 'Your habits' : `${filter} habits`}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{shownHabits.length} total</Text></View>
          {shownHabits.map((habit) => <HabitRow key={habit.habit_id} habit={habit} onOpen={() => setSelected(habit)} onToggle={() => toggleStatus.mutate(habit)} onDelete={() => askDelete(habit)} />)}
        </> : null}
        <View style={{ height: 24 }} />
      </ScrollView>

      {DetailModal}
      <Modal visible={editorOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setEditorOpen(false)}>
        <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
          <Header title={editing ? 'Edit habit' : 'Create a habit'} subtitle={`Step ${editorStep} of 3`} onBack={() => editorStep === 1 ? setEditorOpen(false) : setEditorStep((editorStep - 1) as 1 | 2 | 3)} action={<Pressable onPress={() => setEditorOpen(false)} hitSlop={12}><Text style={{ color: colors.muted, fontSize: 23 }}>×</Text></Pressable>} />
          <View style={[styles.progressTrack, { backgroundColor: colors.primaryTint }]}><View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${(editorStep / 3) * 100}%` }]} /></View>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
          <ScrollView
            style={{ flex: 1, minHeight: 0 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.editorContent, { paddingBottom: 104 }]}
          >
            {editorStep === 1 ? <>
              <Text style={[styles.editorTitle, { color: colors.ink }]}>What habit do you want to build?</Text><Text style={[styles.editorSub, { color: colors.muted }]}>Give it a name and make it feel like yours.</Text>
              <Text style={[styles.fieldLabel, { color: colors.ink }]}>Habit name</Text>
              <TextInput value={draft.name} onChangeText={(v) => updateDraft('name', v)} placeholder="e.g. Journal for 5 minutes" placeholderTextColor={colors.faint} style={[styles.input, { backgroundColor: colors.card, color: colors.ink, borderColor: colors.border }]} returnKeyType="done" maxLength={80} />
              <Text style={[styles.fieldLabel, { color: colors.ink, marginTop: 22 }]}>Choose an icon</Text>
              <View style={styles.emojiGrid}>{EMOJIS.map((emoji) => <Pressable key={emoji} onPress={() => updateDraft('emoji', emoji)} style={[styles.emojiOption, { backgroundColor: draft.emoji === emoji ? colors.primaryTint : colors.card, borderColor: draft.emoji === emoji ? colors.primary : colors.border }]}><Text style={{ fontSize: 23 }}>{emoji}</Text></Pressable>)}</View>
              <Text style={[styles.fieldLabel, { color: colors.ink, marginTop: 20 }]}>Habit color</Text>
              <View style={styles.colorRow}>{HABIT_COLORS.map((c) => <Pressable key={c.key} onPress={() => updateDraft('colorKey', c.key)} accessibilityLabel={c.label} style={[styles.colorDot, { backgroundColor: c.hex, borderColor: draft.colorKey === c.key ? colors.ink : 'transparent' }]}>{draft.colorKey === c.key ? <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>✓</Text> : null}</Pressable>)}</View>
              <Text style={[styles.fieldLabel, { color: colors.ink, marginTop: 22 }]}>Type</Text><View style={styles.choiceRow}><Pill label="Build a good habit" selected={draft.habitType === 'build'} onPress={() => updateDraft('habitType', 'build')} /><Pill label="Break a bad habit" selected={draft.habitType === 'break'} onPress={() => updateDraft('habitType', 'break')} /></View>
            </> : null}
            {editorStep === 2 ? <>
              <Text style={[styles.editorTitle, { color: colors.ink }]}>Make it achievable</Text><Text style={[styles.editorSub, { color: colors.muted }]}>Choose a target and when it fits your day.</Text>
              <Text style={[styles.fieldLabel, { color: colors.ink }]}>Target · Count</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Set the number of counts for each day.</Text>
              <TextInput value={String(draft.targetCount)} onChangeText={setTargetCount} placeholder="1" placeholderTextColor={colors.faint} keyboardType="number-pad" style={[styles.input, { backgroundColor: colors.card, color: colors.ink, borderColor: colors.border, marginTop: 12 }]} />
              <View style={[styles.reminderCard, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 14 }]}><View style={{ flex: 1, paddingRight: 16 }}><Text style={{ color: colors.ink, fontWeight: '700', fontSize: 15 }}>Set a duration for each count</Text><Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Every count uses the same timer. Turn off for an immediate count.</Text></View><Switch value={draft.durationEnabled} onValueChange={(value) => updateDraft('durationEnabled', value)} trackColor={{ true: colors.primary }} /></View>
              {draft.durationEnabled ? <><Text style={[styles.fieldLabel, { color: colors.ink, marginTop: 16 }]}>Duration per count (minutes)</Text><TextInput value={String(draft.targetDuration)} onChangeText={(value) => updateDraft('targetDuration', Math.min(999, Math.max(0, Number.parseInt(value, 10) || 0)))} placeholder="0" placeholderTextColor={colors.faint} keyboardType="number-pad" style={[styles.input, { backgroundColor: colors.card, color: colors.ink, borderColor: colors.border }]} /><Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>0 minutes is allowed.</Text></> : null}
              <Text style={[styles.fieldLabel, { color: colors.ink, marginTop: 22 }]}>How often?</Text><View style={styles.choiceRow}>{([{ key: 'daily', label: 'Every day' }, { key: 'custom', label: 'Custom days' }] as const).map((item) => <Pill key={item.key} label={item.label} selected={draft.frequency === item.key} onPress={() => updateDraft('frequency', item.key)} />)}</View>
              {draft.frequency === 'custom' ? <View style={styles.choiceRow}>{DAYS.map((d, i) => <Pill key={d} label={d} selected={draft.customDays.includes(i)} onPress={() => updateDraft('customDays', draft.customDays.includes(i) ? draft.customDays.filter((v) => v !== i) : [...draft.customDays, i])} />)}</View> : null}
              <Text style={[styles.fieldLabel, { color: colors.ink, marginTop: 22 }]}>Best time of day</Text><View style={styles.choiceRow}>{(['Morning', 'Afternoon', 'Evening', 'Anytime'] as const).map((t) => <Pill key={t} label={t} selected={draft.timeOfDay === t} onPress={() => updateDraft('timeOfDay', t)} />)}</View>
            </> : null}
            {editorStep === 3 ? <>
              <Text style={[styles.editorTitle, { color: colors.ink }]}>A little reminder?</Text><Text style={[styles.editorSub, { color: colors.muted }]}>A gentle nudge can help your routine stick.</Text>
              <View style={[styles.reminderCard, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={{ flex: 1, paddingRight: 16 }}><Text style={{ color: colors.ink, fontWeight: '700', fontSize: 16 }}>Daily reminder</Text><Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Get a notification at your chosen time.</Text></View><Switch value={draft.reminderEnabled} onValueChange={setReminderEnabled} trackColor={{ true: colors.primary }} /></View>
              {draft.reminderEnabled ? <>
                <Text style={[styles.fieldLabel, { color: colors.ink, marginTop: 20 }]}>{draft.targetType === 'count' ? `Reminder times (${draft.targetCount}, one per count)` : 'Reminder time'} · 24-hour</Text>
                {Array.from({ length: draft.targetType === 'count' ? draft.targetCount : 1 }, (_, index) => <View key={index} style={{ marginBottom: 10 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 5 }}>{draft.targetType === 'count' ? `Count ${index + 1} of ${draft.targetCount}` : 'Time'}</Text><TextInput value={draft.reminderTimes[index] ?? '08:00'} onChangeText={(v) => setReminderTime(index, v)} placeholder="08:00" placeholderTextColor={colors.faint} keyboardType="numbers-and-punctuation" maxLength={5} style={[styles.input, { backgroundColor: colors.card, color: colors.ink, borderColor: colors.border }]} /></View>)}
                <Text style={[styles.fieldLabel, { color: colors.ink, marginTop: 12 }]}>Reminder tone</Text>
                <View style={styles.choiceRow}>{([{ key: 'DEFAULT', label: 'Default' }, { key: 'CHIME', label: 'Chime' }, { key: 'ALARM', label: 'Alarm' }] as const).map((tone) => <Pill key={tone.key} label={tone.label} selected={draft.reminderTone === tone.key} onPress={() => updateDraft('reminderTone', tone.key)} />)}</View>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>Custom tones require a development build; Expo Go uses its default tone.</Text>
              </> : null}
              <View style={[styles.reviewCard, { backgroundColor: colors.primaryTint }]}><Text style={{ fontSize: 30 }}>{draft.emoji}</Text><View style={{ flex: 1 }}><Text style={{ color: colors.ink, fontSize: 16, fontWeight: '800' }}>{draft.name.trim() || 'Your new habit'}</Text><Text style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>{draft.habitType === 'build' ? 'Build a good habit' : 'Break a bad habit'} · {draft.frequency === 'daily' ? 'Every day' : `${draft.customDays.length} selected days`}</Text><Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{draft.reminderEnabled ? `Reminder at ${draft.reminderTimes.join(", ")}` : 'No reminder'}</Text></View></View>
            </> : null}
            {formError ? <Text style={{ color: colors.danger, marginTop: 16 }}>{formError}</Text> : null}
          </ScrollView>
          <View style={[styles.editorFooter, { backgroundColor: colors.card, borderTopColor: colors.border }]}><Button label={editorStep === 3 ? (editing ? 'Save changes' : 'Create habit') : 'Continue'} onPress={() => editorStep < 3 ? advanceEditor() : void saveHabit()} loading={saving} style={{ flex: 1 }} /></View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function HabitDetailModal({ habit, onClose, onEdit, onToggle, onDelete, busy }: { habit: Habit; onClose: () => void; onEdit: () => void; onToggle: () => void; onDelete: () => void; busy: boolean }) {
  const { colors } = useTheme();
  const streak = useQuery({ queryKey: ['streak', habit.habit_id], queryFn: () => api.habits.streak(habit.habit_id) });
  const occurrences = useQuery({
    queryKey: ['habit-detail-occurrences', habit.habit_id],
    queryFn: () => {
      const to = toDateString(new Date());
      const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - 27);
      return api.habits.occurrences(habit.habit_id, { from: toDateString(fromDate), to });
    },
  });
  const paused = habit.status === 'PAUSED';
  const schedule = habit.schedule;
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
        <Header title="Habit details" subtitle="Your progress, one day at a time" onBack={onClose} action={<Pressable onPress={onEdit} hitSlop={12}><Text style={{ color: colors.primary, fontWeight: '700' }}>Edit</Text></Pressable>} />
        <ScrollView contentContainerStyle={styles.detailContent}>
          <View style={[styles.detailHero, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={[styles.detailEmoji, { backgroundColor: tint(habit.color || '#A78BFA', 0.2) }]}><Text style={{ fontSize: 42 }}>{habit.icon || '✅'}</Text></View><Text style={[styles.detailTitle, { color: colors.ink }]}>{habit.name}</Text><Text style={{ color: colors.muted, marginTop: 6 }}>{habit.habit_type === 'GOOD' ? 'Building a good habit' : 'Breaking a bad habit'}</Text><View style={[styles.statusPill, { backgroundColor: paused ? colors.surface : colors.primaryTint, alignSelf: 'center', marginTop: 12 }]}><Text style={{ color: paused ? colors.muted : colors.primary, fontWeight: '700', fontSize: 11 }}>{paused ? 'PAUSED' : 'ACTIVE'}</Text></View></View>
          <View style={styles.metricRow}><View style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={{ color: colors.muted, fontSize: 12 }}>Current streak</Text><Text style={{ color: colors.ink, fontSize: 25, fontWeight: '800', marginTop: 7 }}>{streak.data?.current_streak ?? '—'} 🔥</Text></View><View style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={{ color: colors.muted, fontSize: 12 }}>Best streak</Text><Text style={{ color: colors.ink, fontSize: 25, fontWeight: '800', marginTop: 7 }}>{streak.data?.best_streak ?? '—'} 🏆</Text></View></View>
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.sectionTitle, { color: colors.ink }]}>Habit schedule</Text><DetailLine label="Frequency" value={schedule?.frequency_type === 'WEEKDAYS' ? 'Selected weekdays' : 'Every day'} /><DetailLine label="Time of day" value={habit.time_of_day.charAt(0) + habit.time_of_day.slice(1).toLowerCase()} /><DetailLine label="Target" value={`${habit.target_value} ${habit.target_unit || (habit.target_type === 'DURATION' ? 'min' : 'times')}`} />{habit.duration_minutes !== null ? <DetailLine label={habit.target_type === 'COUNT' ? 'Duration per count' : 'Duration'} value={`${habit.duration_minutes} min`} /> : null}<DetailLine label="Reminder" value={schedule?.reminder_times?.length ? schedule.reminder_times.map((time) => time.slice(0, 5)).join(', ') : 'Off'} /><DetailLine label="Tone" value={schedule?.reminder_tone ?? 'DEFAULT'} /></View>
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.sectionTitle, { color: colors.ink }]}>Last 4 weeks</Text><View style={styles.heatDots}>{Array.from({ length: 28 }, (_, i) => { const date = new Date(); date.setDate(date.getDate() - (27 - i)); const key = toDateString(date); const occ = occurrences.data?.find((o) => o.scheduled_date === key); const fill = !occ ? colors.surface : occ.status === 'COMPLETED' || occ.status === 'SKIPPED' ? colors.success : occ.status === 'MISSED' ? colors.danger : colors.border; return <View key={key} style={[styles.heatDot, { backgroundColor: fill }]} />; })}</View><View style={styles.legendRow}><Text style={{ color: colors.muted, fontSize: 11 }}>4 weeks ago</Text><Text style={{ color: colors.muted, fontSize: 11 }}>Today</Text></View></View>
          <Button label={paused ? 'Resume habit' : 'Pause habit'} variant="secondary" onPress={onToggle} loading={busy} style={{ marginTop: 6 }} /><Button label="Delete habit" variant="danger" onPress={onDelete} style={{ marginTop: 10 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return <View style={[styles.detailLine, { borderBottomColor: colors.border }]}><Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text><Text style={{ color: colors.ink, fontWeight: '600', fontSize: 13 }}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: SCREEN_PADDING, paddingTop: 12, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 30, alignItems: 'flex-start', justifyContent: 'center' },
  heading: { fontSize: 23, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 12, marginTop: 3 },
  addButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  content: { padding: SCREEN_PADDING, paddingTop: 16, paddingBottom: 36 },
  summaryCard: { borderRadius: 18, padding: 18, flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  summaryGlyph: { width: 56, height: 56, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 18, flexWrap: 'wrap' },
  pill: { minHeight: 34, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  habitCard: { borderWidth: 1, borderRadius: radius.card, marginBottom: 12, overflow: 'hidden' },
  habitMain: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  habitEmoji: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 13 },
  habitName: { fontSize: 15, fontWeight: '700' },
  statusPill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, marginTop: 7 },
  rowActions: { borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 10 },
  rowAction: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loading: { gap: 9, alignItems: 'center', paddingTop: 48 },
  notice: { padding: 16, borderWidth: 1, borderRadius: radius.card },
  emptyCard: { alignItems: 'center', padding: 24, borderWidth: 1, borderRadius: 18, marginTop: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  emptyCopy: { fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8, marginBottom: 18 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  progressTrack: { height: 5, marginHorizontal: SCREEN_PADDING, borderRadius: 3, overflow: 'hidden', marginTop: 15 },
  progressFill: { height: 5, borderRadius: 3 },
  editorContent: { flexGrow: 1, padding: SCREEN_PADDING, paddingTop: 22, paddingBottom: 28 },
  editorTitle: { fontSize: 23, fontWeight: '800', letterSpacing: -0.4 },
  editorSub: { fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 25 },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginBottom: 9 },
  input: { height: 50, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, fontSize: 15 },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  emojiOption: { width: '17%', minWidth: 48, aspectRatio: 1, borderWidth: 1.5, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  colorDot: { width: 31, height: 31, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  stepperCard: { marginTop: 12, borderRadius: 14, padding: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperButton: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  reminderCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 14, borderWidth: 1 },
  reviewCard: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, borderRadius: 15, marginTop: 28 },
  editorFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 2, elevation: 8, paddingHorizontal: SCREEN_PADDING, paddingTop: 13, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
  detailContent: { padding: SCREEN_PADDING, paddingBottom: 40 },
  detailHero: { alignItems: 'center', borderWidth: 1, borderRadius: 20, padding: 24, marginBottom: 14 },
  detailEmoji: { width: 86, height: 86, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  detailTitle: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  metricRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  metricCard: { flex: 1, borderWidth: 1, borderRadius: 15, padding: 15 },
  sectionCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14 },
  detailLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  heatDots: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  heatDot: { width: '10%', aspectRatio: 1, borderRadius: 4 },
  legendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
});
