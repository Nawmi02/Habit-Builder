import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, describeError } from '../../src/api';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * STUB - Owner: Member 2. Prototype: HabitsList, HabitDetail, HabitWizard.
 * Right now it only proves GET /habits/ (with pagination) works. See the plan doc for the
 * tickets: list, create wizard (3 steps), detail, edit, pause/resume, delete.
 * Use draftToHabitWrite()/habitToDraft() from src/api/mappers.ts - do not hand-build payloads.
 */
export default function Habits() {
  const { colors } = useTheme();
  const habits = useQuery({ queryKey: ['habits'], queryFn: () => api.habits.list() });
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={{ fontSize: 26, fontWeight: '700', color: colors.ink, marginBottom: 12 }}>My Habits</Text>
        {habits.isLoading ? <Text style={{ color: colors.muted }}>Loading…</Text> : null}
        {habits.isError ? <Text style={{ color: colors.danger }}>{describeError(habits.error)}</Text> : null}
        {habits.data?.map((h) => (
          <View key={h.habit_id} style={{ paddingVertical: 10 }}>
            <Text style={{ color: colors.ink, fontSize: 16 }}>{h.icon} {h.name} · {h.status}</Text>
          </View>
        ))}
        <Text style={{ color: colors.faint, marginTop: 24 }}>TODO (Member 2): build this screen from the prototype.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
