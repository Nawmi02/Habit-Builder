
import { useQuery } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, describeError } from '../../src/api';
import type { Habit } from '../../src/api/types';
import {
  habitRates,
  heatmap,
  overallRate,
  weeklyBars,
  type AnalyticsRow,
} from '../../src/lib/analytics';
import {
  addDays,
  eachDay,
  startOfWeek,
  toDateString,
} from '../../src/lib/dates';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, SCREEN_PADDING } from '../../src/theme/tokens';

// Convert a hex color into a translucent background color.
function tint(hex: string, opacity: number): string {
  const normalized = hex.replace('#', '');

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `rgba(167, 139, 250, ${Math.max(
      0,
      Math.min(1, opacity),
    )})`;
  }

  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  const alpha = Math.max(0, Math.min(1, opacity));

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function Header({
  title,
  subtitle,
  action,
  onBack,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  onBack?: () => void;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: colors.card,
          borderBottomColor: colors.border,
        },
      ]}
    >
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={{ color: colors.primary, fontSize: 25 }}>
            ‹
          </Text>
        </Pressable>
      ) : null}

      <View style={{ flex: 1 }}>
        <Text style={[styles.heading, { color: colors.ink }]}>
          {title}
        </Text>

        {subtitle ? (
          <Text
            style={{
              color: colors.muted,
              fontSize: 12,
              marginTop: 3,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      {action}
    </View>
  );
}

function SwitchChip({
  title,
  active,
  onPress,
}: {
  title: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.switchChip,
        {
          backgroundColor: active ? colors.primary : colors.card,
          borderColor: active ? colors.primary : colors.border,
        },
      ]}
    >
      <Text
        style={{
          color: active ? '#FFFFFF' : colors.muted,
          fontWeight: '700',
          fontSize: 13,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export default function Analytics() {
  const { colors } = useTheme();

  const [mode, setMode] = useState<'Weekly' | 'Heatmap'>('Weekly');
  const [weekOffset, setWeekOffset] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);

  const today = toDateString(new Date());

  const historyFrom = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 183);
    return startOfWeek(toDateString(date));
  }, []);

  const habits = useQuery({
    queryKey: ['habits'],
    queryFn: () => api.habits.list(),
  });

  const habitKey = (habits.data ?? [])
    .map((habit) => habit.habit_id)
    .sort((a, b) => a - b)
    .join(',');

  const history = useQuery({
    queryKey: ['analytics', habitKey, historyFrom, today],
    enabled: !!habits.data,
    queryFn: async () => {
      const rows: AnalyticsRow[] = [];

      const list = (habits.data ?? []).filter(
        (habit) => habit.status !== 'DELETED',
      );

      await Promise.all(
        list.map(async (habit) => {
          const occurrences = await api.habits.occurrences(
            habit.habit_id,
            { from: historyFrom, to: today },
          );

          for (const occurrence of occurrences) {
            rows.push({
              habitId: habit.habit_id,
              habitType: habit.habit_type,
              date: occurrence.scheduled_date,
              status: occurrence.status,
            });
          }
        }),
      );

      return rows;
    },
  });

  const rows = history.data ?? [];
  const currentWeekStart = startOfWeek(today);
  const weekStart = addDays(currentWeekStart, weekOffset * 7);

  const bars = useMemo(
    () => weeklyBars(rows, weekStart, today),
    [rows, weekStart, today],
  );

  const rate = overallRate(bars);

  const rates = useMemo(
    () => habitRates(rows, today),
    [rows, today],
  );

  const byId = useMemo(
    () =>
      new Map<number, Habit>(
        (habits.data ?? []).map((habit) => [
          habit.habit_id,
          habit,
        ] as const),
      ),
    [habits.data],
  );

  const heatStart = historyFrom;

  const heatCells = useMemo(
    () => heatmap(rows, heatStart, today, today),
    [rows, heatStart, today],
  );

  const heatByDate = useMemo(
    () => new Map(heatCells.map((cell) => [cell.date, cell] as const)),
    [heatCells],
  );

  const days = eachDay(heatStart, today);
  const weeks = Math.ceil(days.length / 7);
  const hasHistory = rows.length > 0;
  const weekEnd = addDays(weekStart, 6);

  const weekLabel = `${new Date(
    `${weekStart}T12:00:00`,
  ).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} – ${new Date(`${weekEnd}T12:00:00`).toLocaleDateString(
    undefined,
    {
      month: 'short',
      day: 'numeric',
    },
  )}`;

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      <Header
        title="Analytics"
        subtitle="Your consistency, at a glance"
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.modeRow}>
          <SwitchChip
            title="Weekly"
            active={mode === 'Weekly'}
            onPress={() => setMode('Weekly')}
          />
          <SwitchChip
            title="Heatmap"
            active={mode === 'Heatmap'}
            onPress={() => setMode('Heatmap')}
          />
        </View>

        {habits.isLoading || history.isLoading ? (
          <Card style={styles.loadingCard}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={{ color: colors.muted, marginTop: 12 }}>
              Gathering your progress…
            </Text>
          </Card>
        ) : null}

        {habits.isError || history.isError ? (
          <Card>
            <Text
              style={{
                color: colors.danger,
                textAlign: 'center',
              }}
            >
              {describeError(habits.error ?? history.error)}
            </Text>

            <Pressable
              onPress={() => {
                void habits.refetch();
                void history.refetch();
              }}
              style={{ alignItems: 'center', paddingTop: 12 }}
            >
              <Text
                style={{
                  color: colors.primary,
                  fontWeight: '700',
                }}
              >
                Try again
              </Text>
            </Pressable>
          </Card>
        ) : null}

        {!habits.isLoading &&
        !history.isLoading &&
        !hasHistory && mode === 'Weekly' ? (
          <Card style={styles.emptyCard}>
            <View
              style={[
                styles.emptyIcon,
                { backgroundColor: colors.primaryTint },
              ]}
            >
              <Text style={{ fontSize: 32 }}>📊</Text>
            </View>

            <Text
              style={[styles.emptyTitle, { color: colors.ink }]}
            >
              Your story starts here
            </Text>

            <Text
              style={{
                color: colors.muted,
                fontSize: 13,
                lineHeight: 20,
                textAlign: 'center',
              }}
            >
              Complete a few habits and your weekly trends and
              consistency heatmap will appear here.
            </Text>
          </Card>
        ) : null}

        {mode === 'Weekly' &&
        hasHistory &&
        !history.isLoading ? (
          <>
            <Card style={styles.heroCard}>
              <View style={styles.heroTop}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.muted,
                      fontSize: 12,
                      fontWeight: '700',
                      letterSpacing: 0.5,
                    }}
                  >
                    WEEKLY COMPLETION
                  </Text>

                  <Text
                    style={[
                      styles.bigMetric,
                      { color: colors.ink },
                    ]}
                  >
                    {rate === null
                      ? '—'
                      : `${Math.round(rate * 100)}%`}
                  </Text>

                  <Text
                    style={{
                      color: colors.muted,
                      fontSize: 12,
                      marginTop: 2,
                    }}
                  >
                    Based on recorded habit check-ins
                  </Text>
                </View>

                <View
                  style={[
                    styles.heroIcon,
                    { backgroundColor: colors.primaryTint },
                  ]}
                >
                  <Text style={{ fontSize: 28 }}>📈</Text>
                </View>
              </View>

              <View
                style={[
                  styles.weekNav,
                  { borderTopColor: colors.border },
                ]}
              >
                <Pressable
                  onPress={() =>
                    setWeekOffset((value) =>
                      Math.min(0, value + 1),
                    )
                  }
                  style={styles.navButton}
                >
                  <Text
                    style={{
                      color:
                        weekOffset === 0
                          ? colors.faint
                          : colors.primary,
                      fontSize: 20,
                    }}
                  >
                    ‹
                  </Text>
                </Pressable>

                <Text
                  style={{
                    color: colors.ink,
                    fontWeight: '700',
                    fontSize: 13,
                  }}
                >
                  {weekOffset === 0
                    ? `This week · ${weekLabel}`
                    : weekLabel}
                </Text>

                <Pressable
                  onPress={() =>
                    setWeekOffset((value) =>
                      Math.max(-25, value - 1),
                    )
                  }
                  style={styles.navButton}
                >
                  <Text
                    style={{
                      color: colors.primary,
                      fontSize: 20,
                    }}
                  >
                    ›
                  </Text>
                </Pressable>
              </View>
            </Card>

            <Card>
              <View style={styles.cardTitleRow}>
                <Text
                  style={[
                    styles.sectionTitle,
                    { color: colors.ink },
                  ]}
                >
                  Daily activity
                </Text>

                <Text
                  style={{ color: colors.muted, fontSize: 11 }}
                >
                  Mon – Sun
                </Text>
              </View>

              <View style={styles.chart}>
                <View style={styles.chartGuides}>
                  {[0, 1, 2, 3].map((value) => (
                    <View
                      key={value}
                      style={[
                        styles.chartGuide,
                        {
                          borderTopColor: colors.border,
                          top: `${value * 33.33}%`,
                        },
                      ]}
                    />
                  ))}
                </View>

                {bars.map((bar) => {
                  const percent = Math.round(
                    (bar.rate ?? 0) * 100,
                  );

                  const height =
                    bar.rate === null
                      ? 4
                      : Math.max(8, percent * 1.08);

                  return (
                    <View
                      key={bar.date}
                      style={styles.barColumn}
                    >
                      <View
                        style={{
                          flex: 1,
                          width: '100%',
                          justifyContent: 'flex-end',
                          alignItems: 'center',
                        }}
                      >
                        <View
                          style={[
                            styles.barValue,
                            {
                              backgroundColor: bar.isToday
                                ? colors.primary
                                : bar.rate === null
                                  ? colors.surface
                                  : '#C4B5FD',
                              height,
                              borderRadius: 7,
                            },
                          ]}
                        />
                      </View>

                      <Text
                        style={{
                          color: bar.isToday
                            ? colors.primary
                            : colors.muted,
                          fontSize: 10,
                          fontWeight: bar.isToday
                            ? '800'
                            : '500',
                          marginTop: 8,
                        }}
                      >
                        {bar.label}
                      </Text>

                      {bar.isToday ? (
                        <View
                          style={[
                            styles.todayDot,
                            { backgroundColor: colors.primary },
                          ]}
                        />
                      ) : (
                        <View style={{ height: 5 }} />
                      )}
                    </View>
                  );
                })}
              </View>

              <View
                style={[
                  styles.chartLegend,
                  { borderTopColor: colors.border },
                ]}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <View
                    style={[
                      styles.legendDot,
                      { backgroundColor: colors.primary },
                    ]}
                  />
                  <Text
                    style={{ color: colors.muted, fontSize: 11 }}
                  >
                    Today
                  </Text>
                </View>

                <Text
                  style={{ color: colors.muted, fontSize: 11 }}
                >
                  A steady week beats a perfect day
                </Text>
              </View>
            </Card>

            <Card>
              <View style={styles.cardTitleRow}>
                <Text
                  style={[
                    styles.sectionTitle,
                    { color: colors.ink },
                  ]}
                >
                  Top habits
                </Text>

                <Text
                  style={{ color: colors.muted, fontSize: 11 }}
                >
                  By completion
                </Text>
              </View>

              {rates.slice(0, 4).map((item, index) => {
                const habit = byId.get(item.habitId);
                const percent =
                  item.rate === null
                    ? 0
                    : Math.round(item.rate * 100);

                return (
                  <View
                    key={item.habitId}
                    style={styles.topHabit}
                  >
                    <View
                      style={[
                        styles.rankBubble,
                        { backgroundColor: colors.primaryTint },
                      ]}
                    >
                      <Text
                        style={{
                          color: colors.primary,
                          fontWeight: '800',
                          fontSize: 12,
                        }}
                      >
                        {index + 1}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.topHabitIcon,
                        {
                          backgroundColor: tint(
                            habit?.color ?? '#A78BFA',
                            0.2,
                          ),
                        },
                      ]}
                    >
                      <Text style={{ fontSize: 18 }}>
                        {habit?.icon ?? '✅'}
                      </Text>
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text
                        numberOfLines={1}
                        style={{
                          color: colors.ink,
                          fontWeight: '700',
                          fontSize: 13,
                        }}
                      >
                        {habit?.name ?? `Habit ${item.habitId}`}
                      </Text>

                      <View
                        style={[
                          styles.tinyTrack,
                          { backgroundColor: colors.surface },
                        ]}
                      >
                        <View
                          style={[
                            styles.tinyFill,
                            {
                              width: `${percent}%`,
                              backgroundColor: colors.primary,
                            },
                          ]}
                        />
                      </View>
                    </View>

                    <Text
                      style={{
                        color: colors.ink,
                        fontWeight: '800',
                        fontSize: 13,
                      }}
                    >
                      {item.rate === null
                        ? '—'
                        : `${percent}%`}
                    </Text>
                  </View>
                );
              })}
            </Card>

            <Pressable
              onPress={() => setReportOpen(true)}
              style={[
                styles.reportLink,
                { backgroundColor: colors.primaryTint },
              ]}
            >
              <Text
                style={{
                  color: colors.primary,
                  fontWeight: '800',
                  fontSize: 14,
                }}
              >
                View weekly report
              </Text>

              <Text
                style={{ color: colors.primary, fontSize: 22 }}
              >
                ›
              </Text>
            </Pressable>
          </>
        ) : null}

        {mode === 'Heatmap' &&
        !history.isLoading &&
        !history.isError ? (
          <>
            <Card>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.ink },
                ]}
              >
                Consistency heatmap
              </Text>

              <Text
                style={{
                  color: colors.muted,
                  fontSize: 12,
                  lineHeight: 19,
                  marginTop: 5,
                }}
              >
                Each square represents a day. Stronger purple means
                more habits completed or avoided successfully.
              </Text>

              {!hasHistory ? (
                <Text
                  style={{
                    color: colors.muted,
                    fontSize: 12,
                    marginTop: 8,
                  }}
                >
                  No activity yet. Your daily progress will show here.
                </Text>
              ) : null}

              <View style={styles.monthLabels}>
                {[0, 4, 8, 12, 16, 20, 24].map((week) => {
                  const date = addDays(heatStart, week * 7);

                  return (
                    <Text
                      key={week}
                      style={{
                        color: colors.muted,
                        fontSize: 10,
                      }}
                    >
                      {new Date(
                        `${date}T12:00:00`,
                      ).toLocaleDateString(undefined, {
                        month: 'short',
                      })}
                    </Text>
                  );
                })}
              </View>

              <View style={styles.heatmapBox}>
                <View style={styles.dayLabels}>
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(
                    (day, index) => (
                      <Text
                        key={`${day}${index}`}
                        style={{
                          width: 14,
                          height: 14,
                          color: colors.muted,
                          fontSize: 9,
                          textAlign: 'center',
                        }}
                      >
                        {day}
                      </Text>
                    ),
                  )}
                </View>

                <View style={{ flex: 1 }}>
                  {Array.from({ length: 7 }, (_, dayIndex) => (
                    <View
                      key={dayIndex}
                      style={styles.heatmapRow}
                    >
                      {Array.from({ length: weeks }, (_, week) => {
                        const date = addDays(
                          heatStart,
                          week * 7 + dayIndex,
                        );

                        const cell = heatByDate.get(date);

                        const intensityColors = [
                          colors.surface,
                          '#EDE9FE',
                          '#C4B5FD',
                          '#8B5CF6',
                          '#6D28D9',
                        ];

                        return (
                          <View
                            key={date}
                            style={[
                              styles.heatSquare,
                              {
                                backgroundColor: cell && cell.intensity > 0
                                  ? intensityColors[cell.intensity]
                                  : colors.bg,
                                borderColor: cell && cell.intensity > 0
                                  ? 'transparent'
                                  : colors.border,
                              },
                            ]}
                          />
                        );
                      })}
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.legendRow}>
                <Text
                  style={{ color: colors.muted, fontSize: 10 }}
                >
                  Less
                </Text>

                {[
                  '#F0EEF3',
                  '#EDE9FE',
                  '#C4B5FD',
                  '#8B5CF6',
                  '#6D28D9',
                ].map((color, index) => (
                  <View
                    key={index}
                    style={[
                      styles.legendSquare,
                      { backgroundColor: color },
                    ]}
                  />
                ))}

                <Text
                  style={{ color: colors.muted, fontSize: 10 }}
                >
                  More
                </Text>
              </View>
            </Card>

            <Card>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.ink, marginBottom: 12 },
                ]}
              >
                Habit consistency
              </Text>

              {rates.slice(0, 6).map((item) => {
                const habit = byId.get(item.habitId);
                const percent =
                  item.rate === null
                    ? null
                    : Math.round(item.rate * 100);

                return (
                  <View
                    key={item.habitId}
                    style={styles.rateRow}
                  >
                    <View
                      style={[
                        styles.topHabitIcon,
                        {
                          backgroundColor: tint(
                            habit?.color ?? '#A78BFA',
                            0.2,
                          ),
                        },
                      ]}
                    >
                      <Text style={{ fontSize: 18 }}>
                        {habit?.icon ?? '✅'}
                      </Text>
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color: colors.ink,
                          fontWeight: '700',
                          fontSize: 13,
                        }}
                      >
                        {habit?.name ?? 'Habit'}
                      </Text>

                      <Text
                        style={{
                          color: colors.muted,
                          fontSize: 11,
                          marginTop: 2,
                        }}
                      >
                        {item.success} successful · {item.fail} missed
                        or slipped
                      </Text>
                    </View>

                    <Text
                      style={{
                        color: colors.primary,
                        fontWeight: '800',
                      }}
                    >
                      {percent === null ? '—' : `${percent}%`}
                    </Text>
                  </View>
                );
              })}
            </Card>
          </>
        ) : null}

        <View style={{ height: 24 }} />
      </ScrollView>

      <Modal
        visible={reportOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setReportOpen(false)}
      >
        <SafeAreaView
          style={[styles.screen, { backgroundColor: colors.bg }]}
          edges={['top']}
        >
          <Header
            title="Weekly report"
            subtitle="A closer look at your consistency"
            onBack={() => setReportOpen(false)}
          />

          <ScrollView contentContainerStyle={styles.content}>
            <Card style={styles.reportHero}>
              <Text
                style={{
                  color: '#EDE9FE',
                  fontWeight: '700',
                  fontSize: 12,
                }}
              >
                WEEKLY COMPLETION
              </Text>

              <Text
                style={{
                  color: '#FFFFFF',
                  fontSize: 44,
                  fontWeight: '900',
                  marginTop: 5,
                }}
              >
                {rate === null
                  ? '—'
                  : `${Math.round(rate * 100)}%`}
              </Text>

              <Text
                style={{
                  color: '#EDE9FE',
                  fontSize: 12,
                  marginTop: 2,
                }}
              >
                {weekLabel}
              </Text>
            </Card>

            <Card>
              <View style={styles.weekNav}>
                <Pressable
                  onPress={() =>
                    setWeekOffset((value) =>
                      Math.min(0, value + 1),
                    )
                  }
                >
                  <Text
                    style={{
                      color:
                        weekOffset === 0
                          ? colors.faint
                          : colors.primary,
                      fontSize: 25,
                    }}
                  >
                    ‹
                  </Text>
                </Pressable>

                <Text
                  style={{
                    color: colors.ink,
                    fontWeight: '800',
                  }}
                >
                  {weekLabel}
                </Text>

                <Pressable
                  onPress={() =>
                    setWeekOffset((value) =>
                      Math.max(-25, value - 1),
                    )
                  }
                >
                  <Text
                    style={{
                      color: colors.primary,
                      fontSize: 25,
                    }}
                  >
                    ›
                  </Text>
                </Pressable>
              </View>

              <View style={styles.reportStats}>
                <View style={styles.reportStat}>
                  <Text
                    style={{
                      color: colors.muted,
                      fontSize: 12,
                    }}
                  >
                    Successful days
                  </Text>

                  <Text
                    style={{
                      color: colors.ink,
                      fontSize: 23,
                      fontWeight: '800',
                    }}
                  >
                    {bars.reduce(
                      (total, bar) => total + bar.success,
                      0,
                    )}
                  </Text>
                </View>

                <View style={styles.reportStat}>
                  <Text
                    style={{
                      color: colors.muted,
                      fontSize: 12,
                    }}
                  >
                    Missed or slipped
                  </Text>

                  <Text
                    style={{
                      color: colors.ink,
                      fontSize: 23,
                      fontWeight: '800',
                    }}
                  >
                    {bars.reduce(
                      (total, bar) => total + bar.fail,
                      0,
                    )}
                  </Text>
                </View>
              </View>
            </Card>

            <Card>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.ink, marginBottom: 12 },
                ]}
              >
                Habits to celebrate
              </Text>

              {rates.slice(0, 3).map((item) => {
                const habit = byId.get(item.habitId);

                return (
                  <View
                    key={item.habitId}
                    style={styles.rateRow}
                  >
                    <Text style={{ fontSize: 22 }}>
                      {habit?.icon ?? '✅'}
                    </Text>

                    <Text
                      style={{
                        color: colors.ink,
                        fontWeight: '700',
                        flex: 1,
                      }}
                    >
                      {habit?.name ?? 'Habit'}
                    </Text>

                    <Text
                      style={{
                        color: colors.primary,
                        fontWeight: '800',
                      }}
                    >
                      {item.rate === null
                        ? '—'
                        : `${Math.round(item.rate * 100)}%`}
                    </Text>
                  </View>
                );
              })}
            </Card>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  heading: {
    fontSize: 23,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  content: {
    padding: SCREEN_PADDING,
    paddingTop: 16,
    paddingBottom: 36,
    gap: 14,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  switchChip: {
    paddingHorizontal: 17,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: radius.card,
    padding: 16,
    borderWidth: 1,
  },
  loadingCard: {
    alignItems: 'center',
    padding: 36,
  },
  emptyCard: {
    alignItems: 'center',
    padding: 26,
    gap: 10,
  },
  emptyIcon: {
    width: 70,
    height: 70,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
  },
  heroCard: {
    paddingBottom: 0,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 18,
  },
  bigMetric: {
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '900',
    letterSpacing: -1.2,
    marginTop: 5,
  },
  heroIcon: {
    width: 60,
    height: 60,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    gap: 10,
  },
  navButton: {
    width: 30,
    alignItems: 'center',
  },
  chart: {
    height: 155,
    flexDirection: 'row',
    gap: 8,
    paddingTop: 16,
    paddingHorizontal: 2,
  },
  chartGuides: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 16,
    bottom: 23,
  },
  chartGuide: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    zIndex: 1,
  },
  barValue: {
    width: '68%',
    minHeight: 4,
  },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 1,
  },
  chartLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
    paddingTop: 11,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  topHabit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 14,
  },
  rankBubble: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topHabitIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tinyTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 7,
  },
  tinyFill: {
    height: 4,
    borderRadius: 2,
  },
  reportLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 13,
  },
  monthLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: 22,
    marginTop: 18,
    marginBottom: 8,
  },
  heatmapBox: {
    flexDirection: 'row',
    gap: 7,
  },
  dayLabels: {
    width: 14,
    gap: 3,
  },
  heatmapRow: {
    flexDirection: 'row',
    gap: 3,
    marginBottom: 3,
  },
  heatSquare: {
    width: 9,
    height: 12,
    borderRadius: 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
    marginTop: 14,
  },
  legendSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(150,150,150,0.16)',
  },
  reportHero: {
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
    padding: 22,
  },
  reportStats: {
    flexDirection: 'row',
    gap: 15,
    paddingTop: 15,
  },
  reportStat: {
    flex: 1,
    gap: 5,
  },
});
