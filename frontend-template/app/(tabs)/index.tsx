
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/features/auth/AuthProvider';
import { api, describeError } from '../../src/api';
import type { Habit } from '../../src/api/types';
import { tint } from '../../src/api/mappers';
import { Button } from '../../src/components/Button';
import { toDateString } from '../../src/lib/dates';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, SCREEN_PADDING } from '../../src/theme/tokens';
import { syncReminders } from '../../src/notifications/syncReminders';

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function SectionTitle({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.ink }]}>
        {title}
      </Text>

      {action && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text
            style={{
              color: colors.primary,
              fontSize: 13,
              fontWeight: '800',
            }}
          >
            {action} ›
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function StatCard({
  emoji,
  value,
  label,
}: {
  emoji: string;
  value: string;
  label: string;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.statCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={{ fontSize: 20 }}>{emoji}</Text>

      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.statValue, { color: colors.ink }]}
      >
        {value}
      </Text>

      <Text style={[styles.statLabel, { color: colors.muted }]}>
        {label}
      </Text>
    </View>
  );
}

function TodayHabitRow({
  habit,
  status,
  onPress,
}: {
  habit: Habit;
  status?: string | null;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  const completed =
    status === 'COMPLETED' || status === 'SKIPPED';
  const missed = status === 'MISSED';

  const statusLabel = completed
    ? status === 'SKIPPED'
      ? 'SKIPPED'
      : 'DONE'
    : missed
      ? 'MISSED'
      : 'UP NEXT';

  const statusColor = completed
    ? colors.success
    : missed
      ? colors.danger
      : colors.muted;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${habit.name}. ${statusLabel}. Open habits.`}
      style={({ pressed }) => [
        styles.habitRow,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.78 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.habitIcon,
          {
            backgroundColor: tint(
              habit.color || '#A78BFA',
              0.18,
            ),
          },
        ]}
      >
        <Text style={{ fontSize: 23 }}>
          {habit.icon || '✅'}
        </Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={[
            styles.habitName,
            { color: colors.ink },
          ]}
        >
          {habit.name}
        </Text>

        <Text
          numberOfLines={1}
          style={{
            color: colors.muted,
            fontSize: 12,
            marginTop: 4,
          }}
        >
          {habit.time_of_day === 'ANYTIME'
            ? 'Whenever you are ready'
            : `${habit.time_of_day.charAt(0)}${habit.time_of_day
                .slice(1)
                .toLowerCase()} routine`}
        </Text>
      </View>

      <View style={styles.habitStatus}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: statusColor },
          ]}
        />

        <Text
          style={{
            color: statusColor,
            fontSize: 9,
            fontWeight: '900',
            letterSpacing: 0.3,
          }}
        >
          {statusLabel}
        </Text>
      </View>
    </Pressable>
  );
}

export default function Home() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const firstName =
    user?.name?.trim().split(/\s+/)[0] || 'there';

  const today = toDateString(new Date());

  const habitsQuery = useQuery({
    queryKey: ['habits'],
    queryFn: () => api.habits.list(),
  });

  const pointsQuery = useQuery({
    queryKey: ['points'],
    queryFn: api.points.summary,
  });

  const allHabits = habitsQuery.data ?? [];

  const activeHabits = useMemo(
    () => allHabits.filter((habit) => habit.status === 'ACTIVE'),
    [allHabits],
  );

  const pausedCount = allHabits.filter(
    (habit) => habit.status === 'PAUSED',
  ).length;

  const activeHabitIds = activeHabits
    .map((habit) => habit.habit_id)
    .sort((a, b) => a - b)
    .join(',');

  const todayQuery = useQuery({
    queryKey: ['home-today-checkins', today, activeHabitIds],
    enabled: !habitsQuery.isLoading && !habitsQuery.isError,
    queryFn: async () => {
      return Promise.all(
        activeHabits.map(async (habit) => {
          const occurrences = await api.habits.occurrences(
            habit.habit_id,
            {
              from: today,
              to: today,
            },
          );

          return {
            habitId: habit.habit_id,
            occurrence:
              occurrences.find(
                (item) => item.scheduled_date === today,
              ) ?? null,
          };
        }),
      );
    },
  });

  const todayRows = todayQuery.data ?? [];

  const statusByHabit = useMemo(
    () =>
      new Map(
        todayRows.map((row) => [
          row.habitId,
          row.occurrence?.status ?? null,
        ]),
      ),
    [todayRows],
  );

  const completedCount = todayRows.filter(
    (row) =>
      row.occurrence?.status === 'COMPLETED' ||
      row.occurrence?.status === 'SKIPPED',
  ).length;

  const missedCount = todayRows.filter(
    (row) => row.occurrence?.status === 'MISSED',
  ).length;

  const completionPercent =
    activeHabits.length > 0
      ? Math.round(
          (completedCount / activeHabits.length) * 100,
        )
      : 0;

  const refreshing =
    habitsQuery.isRefetching ||
    pointsQuery.isRefetching ||
    todayQuery.isRefetching;

  async function refreshDashboard() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['habits'] }),
      queryClient.invalidateQueries({ queryKey: ['points'] }),
      queryClient.invalidateQueries({ queryKey: ['analytics'] }),
      queryClient.invalidateQueries({
        queryKey: ['home-today-checkins'],
      }),
    ]);
  }

  async function answerHabit(habit: Habit, choice: 'start' | 'yes' | 'no') {
    const occurrence = todayRows.find((row) => row.habitId === habit.habit_id)?.occurrence;
    if (!occurrence || occurrence.status !== 'PENDING') return;
    try {
      if (choice === 'start') {
        await api.occurrences.start(occurrence.occurrence_id);
      } else if (choice === 'yes') {
        if (habit.habit_type === 'BAD') await api.occurrences.skip(occurrence.occurrence_id, {});
        else await api.occurrences.complete(occurrence.occurrence_id, { progress_value: habit.target_value, mood: 'GOOD' });
        Alert.alert('🎉🎊🥳', 'Target achieved! Great work.');
      } else if (habit.habit_type === 'BAD') {
        await api.occurrences.complete(occurrence.occurrence_id, { progress_value: habit.target_value });
      } else {
        Alert.alert('😞💔 Better luck next time', 'Your streak did not increase today.');
        return;
      }
      await refreshDashboard();
      await syncReminders(user!);
    } catch (error) {
      Alert.alert('Could not update habit', describeError(error));
    }
  }

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const loading =
    habitsQuery.isLoading || pointsQuery.isLoading;

  const error =
    habitsQuery.error ??
    pointsQuery.error ??
    (todayQuery.isError ? todayQuery.error : null);

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refreshDashboard()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Dayleebit brand header */}
        <View style={styles.appTopBar}>
          <View style={styles.brandBlock}>
            <View
              style={[
                styles.brandLogo,
                { backgroundColor: colors.primaryTint },
              ]}
            >
              <Text style={{ fontSize: 23 }}>🌱</Text>
            </View>

            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.brandName,
                  { color: colors.ink },
                ]}
              >
                Dayleebit
              </Text>

              <Text
                numberOfLines={1}
                style={{
                  color: colors.muted,
                  fontSize: 10,
                  marginTop: 2,
                }}
              >
                A Little Better Every Day.
              </Text>
            </View>
          </View>

          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            accessibilityLabel="Open Settings"
            hitSlop={8}
            style={({ pressed }) => [
              styles.settingsButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text style={{ fontSize: 20 }}>⚙️</Text>
          </Pressable>
        </View>

        {/* Personalized greeting */}
        <View style={styles.greetingBlock}>
          <Text
            style={{
              color: colors.muted,
              fontSize: 12,
              fontWeight: '600',
            }}
          >
            {dateLabel}
          </Text>

          <Text
            style={[
              styles.greeting,
              { color: colors.ink },
            ]}
          >
            {getGreeting()}, {firstName} ✨
          </Text>

          <Text
            style={{
              color: colors.muted,
              fontSize: 13,
              marginTop: 5,
            }}
          >
            Ready to make today count?
          </Text>
        </View>

        {loading ? (
          <View
            style={[
              styles.messageCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <ActivityIndicator color={colors.primary} />

            <Text
              style={{
                color: colors.muted,
                marginTop: 10,
              }}
            >
              Preparing your day…
            </Text>
          </View>
        ) : null}

        {error ? (
          <View
            style={[
              styles.messageCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              style={{
                color: colors.danger,
                textAlign: 'center',
                lineHeight: 20,
              }}
            >
              {describeError(error)}
            </Text>

            <Button
              label="Try again"
              variant="secondary"
              onPress={() => void refreshDashboard()}
              style={{ marginTop: 12, alignSelf: 'stretch' }}
            />
          </View>
        ) : null}

        {/* Today's progress */}
        <View
          style={[
            styles.progressCard,
            { backgroundColor: colors.primary },
          ]}
        >
          <View style={styles.progressHeader}>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: '#EDE9FE',
                  fontSize: 12,
                  fontWeight: '800',
                  letterSpacing: 0.6,
                }}
              >
                YOUR DAILY JOURNEY
              </Text>

              <Text style={styles.progressHeading}>
                Make today count.
              </Text>

              <Text style={styles.progressSubtitle}>
                {activeHabits.length === 0
                  ? 'Start with one small habit.'
                  : completedCount === activeHabits.length
                    ? 'Amazing! You completed every active habit.'
                    : `${completedCount} of ${activeHabits.length} active habits completed`}
              </Text>
            </View>

            <View style={styles.progressIllustration}>
              <Text style={{ fontSize: 31 }}>🎯</Text>
            </View>
          </View>

          <View style={styles.progressNumbers}>
            <Text
              style={{
                color: '#FFFFFF',
                fontSize: 32,
                fontWeight: '900',
              }}
            >
              {completionPercent}%
            </Text>

            <Text
              style={{
                color: '#EDE9FE',
                fontSize: 12,
                fontWeight: '600',
              }}
            >
              today's progress
            </Text>
          </View>

          <View
            accessibilityRole="progressbar"
            accessibilityValue={{
              min: 0,
              max: 100,
              now: completionPercent,
            }}
            style={styles.progressTrack}
          >
            <View
              style={[
                styles.progressFill,
                { width: `${completionPercent}%` },
              ]}
            />
          </View>

          <View style={styles.progressFooter}>
            <Text
              style={{
                color: '#EDE9FE',
                fontSize: 11,
              }}
            >
              {Math.max(
                0,
                activeHabits.length - completedCount,
              )}{' '}
              left to complete
            </Text>

            <Text
              style={{
                color: '#EDE9FE',
                fontSize: 11,
              }}
            >
              Keep going 🌟
            </Text>
          </View>
        </View>

        {/* Quick stats */}
        <View style={styles.statsRow}>
          <StatCard
            emoji="✅"
            value={String(completedCount)}
            label="Completed"
          />

          <StatCard
            emoji="🔥"
            value={String(pointsQuery.data?.level ?? 1)}
            label="Current level"
          />

          <StatCard
            emoji="✨"
            value={String(pointsQuery.data?.total_points ?? 0)}
            label="Total XP"
          />
        </View>

        {/* Today's habits */}
        <SectionTitle
          title="Today's habits"
          action="View all"
          onAction={() => router.push('/(tabs)/habits')}
        />

        {habitsQuery.isSuccess &&
        !todayQuery.isLoading &&
        !todayQuery.isError &&
        activeHabits.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.emptyIcon,
                { backgroundColor: colors.primaryTint },
              ]}
            >
              <Text style={{ fontSize: 31 }}>🌱</Text>
            </View>

            <Text
              style={[
                styles.emptyTitle,
                { color: colors.ink },
              ]}
            >
              Start small. Start today.
            </Text>

            <Text
              style={{
                color: colors.muted,
                fontSize: 13,
                lineHeight: 20,
                textAlign: 'center',
                marginTop: 7,
                marginBottom: 15,
              }}
            >
              Choose one small action and turn it into a routine.
            </Text>

            <Button
              label="Create your first habit"
              onPress={() => router.push('/(tabs)/habits')}
              style={{ alignSelf: 'stretch' }}
            />

            {pausedCount > 0 ? (
              <Text
                style={{
                  color: colors.muted,
                  fontSize: 11,
                  marginTop: 10,
                }}
              >
                You also have {pausedCount} paused habit
                {pausedCount === 1 ? '' : 's'}.
              </Text>
            ) : null}
          </View>
        ) : null}

        {todayQuery.isLoading && !habitsQuery.isLoading ? (
          <View
            style={{
              paddingVertical: 20,
              alignItems: 'center',
            }}
          >
            <ActivityIndicator color={colors.primary} />
            <Text
              style={{
                color: colors.muted,
                fontSize: 12,
                marginTop: 9,
              }}
            >
              Checking today's habits…
            </Text>
          </View>
        ) : null}

        {todayQuery.isError ? (
          <View
            style={[
              styles.messageCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              style={{
                color: colors.danger,
                fontSize: 13,
                textAlign: 'center',
              }}
            >
              {describeError(todayQuery.error)}
            </Text>

            <Pressable
              onPress={() => void todayQuery.refetch()}
              style={{ paddingTop: 12 }}
            >
              <Text
                style={{
                  color: colors.primary,
                  textAlign: 'center',
                  fontWeight: '800',
                }}
              >
                Retry
              </Text>
            </Pressable>
          </View>
        ) : null}

        {activeHabits.length > 0 && todayQuery.isSuccess ? (
          <>
            {activeHabits.slice(0, 5).map((habit) => {
              const occurrence = todayRows.find((row) => row.habitId === habit.habit_id)?.occurrence;
              const isPending = occurrence?.status === 'PENDING';
              const isStarted = !!occurrence?.started_at;
              return (
                <View key={habit.habit_id}>
                  <TodayHabitRow
                    habit={habit}
                    status={statusByHabit.get(habit.habit_id)}
                    onPress={() => router.push('/(tabs)/habits')}
                  />
                  {isPending ? (
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: -6, marginBottom: 10 }}>
                      {!isStarted ? (
                        <Pressable onPress={() => void answerHabit(habit, 'start')} style={styles.quickAction}>
                          <Text style={styles.quickActionText}>Start habit</Text>
                        </Pressable>
                      ) : (
                        <>
                          <Pressable onPress={() => void answerHabit(habit, 'yes')} style={styles.quickAction}>
                            <Text style={styles.quickActionText}>Yes, target achieved 🎉</Text>
                          </Pressable>
                          <Pressable onPress={() => void answerHabit(habit, 'no')} style={[styles.quickAction, { backgroundColor: colors.surface }]}>
                            <Text style={[styles.quickActionText, { color: colors.muted }]}>No</Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}

            {activeHabits.length > 5 ? (
              <Pressable
                onPress={() => router.push('/(tabs)/habits')}
                style={styles.moreHabits}
              >
                <Text
                  style={{
                    color: colors.primary,
                    fontSize: 13,
                    fontWeight: '800',
                  }}
                >
                  View {activeHabits.length - 5} more habits ›
                </Text>
              </Pressable>
            ) : null}

            {missedCount > 0 ? (
              <Text
                style={{
                  color: colors.muted,
                  fontSize: 11,
                  marginTop: 2,
                }}
              >
                Missed check-ins today: {missedCount}
              </Text>
            ) : null}
          </>
        ) : null}

        {/* Level and points */}
        <SectionTitle title="Your journey" />

        <Pressable
          onPress={() => router.push('/(tabs)/gamification')}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.journeyCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <View
            style={[
              styles.journeyIcon,
              { backgroundColor: colors.primaryTint },
            ]}
          >
            <Text style={{ fontSize: 25 }}>🏆</Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.ink,
                fontWeight: '800',
                fontSize: 14,
              }}
            >
              Level {pointsQuery.data?.level ?? 1}
            </Text>

            <Text
              style={{
                color: colors.muted,
                fontSize: 12,
                lineHeight: 18,
                marginTop: 3,
              }}
            >
              {pointsQuery.data?.points_to_next_level != null
                ? `${pointsQuery.data.points_to_next_level} XP to your next level`
                : 'Every small step moves you forward.'}
            </Text>
          </View>

          <Text
            style={{
              color: colors.primary,
              fontSize: 24,
            }}
          >
            ›
          </Text>
        </Pressable>

        {/* Shortcuts */}
        <SectionTitle title="Explore your progress" />

        <View style={styles.shortcutRow}>
          <Pressable
            onPress={() => router.push('/(tabs)/analytics')}
            style={({ pressed }) => [
              styles.shortcutCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.shortcutIcon,
                { backgroundColor: colors.primaryTint },
              ]}
            >
              <Text style={{ fontSize: 23 }}>📈</Text>
            </View>

            <Text
              style={{
                color: colors.ink,
                fontSize: 14,
                fontWeight: '800',
              }}
            >
              Analytics
            </Text>

            <Text
              style={{
                color: colors.muted,
                fontSize: 11,
                marginTop: 5,
                lineHeight: 17,
              }}
            >
              See your trends
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push('/(tabs)/gamification')}
            style={({ pressed }) => [
              styles.shortcutCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.shortcutIcon,
                { backgroundColor: colors.primaryTint },
              ]}
            >
              <Text style={{ fontSize: 23 }}>🏅</Text>
            </View>

            <Text
              style={{
                color: colors.ink,
                fontSize: 14,
                fontWeight: '800',
              }}
            >
              Achievements
            </Text>

            <Text
              style={{
                color: colors.muted,
                fontSize: 11,
                marginTop: 5,
                lineHeight: 17,
              }}
            >
              Unlock your badges
            </Text>
          </Pressable>
        </View>

        <View
          style={[
            styles.motto,
            { backgroundColor: colors.primaryTint },
          ]}
        >
          <Text style={{ fontSize: 23 }}>🌿</Text>

          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.primary,
                fontWeight: '800',
                fontSize: 13,
              }}
            >
              Small steps still count.
            </Text>

            <Text
              style={{
                color: colors.muted,
                fontSize: 12,
                lineHeight: 18,
                marginTop: 3,
              }}
            >
              You don't need a perfect day. Just take the next step.
            </Text>
          </View>
        </View>

        <View style={{ height: 28 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },

  content: {
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: 18,
    paddingBottom: 32,
  },

  appTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 20,
  },

  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },

  brandLogo: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  brandName: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },

  settingsButton: {
    width: 43,
    height: 43,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  greetingBlock: {
    marginBottom: 21,
  },

  greeting: {
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '900',
    letterSpacing: -0.7,
    marginTop: 5,
  },

  progressCard: {
    padding: 19,
    borderRadius: 22,
    marginBottom: 14,
    shadowColor: '#6D28D9',
    shadowOpacity: 0.16,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },

  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  progressHeading: {
    color: '#FFFFFF',
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '900',
    marginTop: 6,
  },

  progressSubtitle: {
    color: '#EDE9FE',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },

  progressIllustration: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  progressNumbers: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 23,
    marginBottom: 9,
  },

  progressTrack: {
    height: 9,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },

  progressFill: {
    height: 9,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },

  progressFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 9,
  },

  statsRow: {
    flexDirection: 'row',
    gap: 9,
    marginBottom: 26,
  },

  statCard: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },

  statValue: {
    fontSize: 21,
    fontWeight: '900',
    marginTop: 7,
  },

  statLabel: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
    marginTop: 4,
  },

  sectionTitle: {
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.3,
  },

  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 12,
    borderWidth: 1,
    borderRadius: 16,
    marginBottom: 9,
  },

  habitIcon: {
    width: 47,
    height: 47,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  habitName: {
    fontSize: 14,
    fontWeight: '800',
  },

  habitStatus: {
    alignItems: 'flex-end',
    gap: 5,
  },

  quickAction: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: '#6D28D9',
  },

  quickActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },

  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  moreHabits: {
    alignItems: 'center',
    paddingVertical: 12,
  },

  emptyCard: {
    alignItems: 'center',
    padding: 23,
    borderWidth: 1,
    borderRadius: radius.card,
    marginBottom: 14,
  },

  emptyIcon: {
    width: 70,
    height: 70,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 13,
  },

  emptyTitle: {
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },

  journeyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 15,
    borderRadius: 17,
    borderWidth: 1,
    marginBottom: 25,
  },

  journeyIcon: {
    width: 50,
    height: 50,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  shortcutRow: {
    flexDirection: 'row',
    gap: 11,
    marginBottom: 20,
  },

  shortcutCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 17,
    borderWidth: 1,
    padding: 14,
  },

  shortcutIcon: {
    width: 47,
    height: 47,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },

  motto: {
    borderRadius: 16,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  messageCard: {
    alignItems: 'center',
    padding: 20,
    borderRadius: 17,
    borderWidth: 1,
    marginBottom: 15,
  },
});
