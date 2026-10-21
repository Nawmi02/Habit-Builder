import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { statusText, tint } from '../api/mappers';
import type { ChecklistItem } from '../api/types';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { ProgressRing } from './ProgressRing';

function targetText(i: ChecklistItem): string {
  if (i.target_type === 'YES_NO') return i.habit_type === 'BAD' ? 'Stay strong today' : 'Once today';
  return `${i.target_value} ${i.target_unit || (i.target_type === 'DURATION' ? 'min' : 'times')}`;
}

/** One row of the daily checklist (mirrors the prototype's HabitTile). */
export function HabitTile({ item, onPress }: { item: ChecklistItem; onPress: (item: ChecklistItem) => void }) {
  const { colors } = useTheme();
  const pending = item.status === 'PENDING';
  const good = item.habit_type === 'GOOD' ? item.status === 'COMPLETED' : item.status === 'SKIPPED';
  const muted = item.status === 'SKIPPED' && item.habit_type === 'GOOD';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${statusText(item.habit_type, item.status)}`}
      disabled={!pending}
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: good ? colors.primaryTint : colors.card, borderColor: colors.border, opacity: pressed ? 0.9 : muted ? 0.65 : 1 },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: tint(item.color) }]}>
        <Text style={styles.emoji}>{item.icon || '✅'}</Text>
      </View>
      <View style={styles.body}>
        <Text style={[styles.name, { color: colors.ink }, good && styles.struck]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {pending ? targetText(item) : statusText(item.habit_type, item.status)}
        </Text>
      </View>
      {pending ? (
        <ProgressRing fraction={0} />
      ) : (
        <View style={[styles.badge, { backgroundColor: good ? colors.success : item.status === 'MISSED' || item.status === 'COMPLETED' ? colors.danger : colors.faint }]}>
          <Text style={styles.badgeText}>{good ? '✓' : item.status === 'SKIPPED' ? '–' : '!'}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flexDirection: 'row', alignItems: 'center', minHeight: 76, borderRadius: radius.tile, borderWidth: 1, padding: 16, marginBottom: 12 },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 22 },
  body: { flex: 1, marginHorizontal: 14 },
  name: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  struck: { opacity: 0.8 },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontWeight: '700' },
});
