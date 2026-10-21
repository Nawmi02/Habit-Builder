import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, describeError } from '../../src/api';
import { badgeIcon } from '../../src/lib/badges';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * STUB - Owner: Member 3. Prototype: ProgressScreen, BadgeGallery, BadgeUnlock.
 * Proves GET /points/summary/ and GET /badges/. Show XP/level from points.summary() -
 * NOT from the `reward` field of the complete response (it can disagree).
 */
export default function Gamification() {
  const { colors } = useTheme();
  const points = useQuery({ queryKey: ['points'], queryFn: api.points.summary });
  const badges = useQuery({ queryKey: ['badges'], queryFn: api.badges.list });
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={{ fontSize: 26, fontWeight: '700', color: colors.ink, marginBottom: 12 }}>Progress</Text>
        {points.isError ? <Text style={{ color: colors.danger }}>{describeError(points.error)}</Text> : null}
        {points.data ? (
          <Text style={{ color: colors.ink, fontSize: 16, marginBottom: 12 }}>
            Level {points.data.level} · {points.data.total_points} XP · {points.data.points_to_next_level} to next level
          </Text>
        ) : null}
        {badges.data?.map((b) => (
          <Text key={b.badge_id} style={{ color: b.unlocked ? colors.ink : colors.faint, paddingVertical: 6 }}>
            {badgeIcon(b.code)} {b.name} {b.unlocked ? '✓' : `${b.progress}/${b.condition_value}`}
          </Text>
        ))}
        <Text style={{ color: colors.faint, marginTop: 24 }}>TODO (Member 3): build this screen from the prototype.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
