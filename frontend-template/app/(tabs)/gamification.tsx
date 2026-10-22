
import { useQuery } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../src/components/Button';
import { api, describeError } from '../../src/api';
import type { Badge } from '../../src/api/types';
import { badgeIcon } from '../../src/lib/badges';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, SCREEN_PADDING } from '../../src/theme/tokens';

const FILTERS = [
  'All',
  'Unlocked',
  'Locked',
  'Streak',
  'Milestone',
  'Points',
] as const;

type BadgeFilter = (typeof FILTERS)[number];

function category(
  badge: Badge,
): 'Streak' | 'Milestone' | 'Points' {
  if (badge.condition_type === 'STREAK_DAYS') return 'Streak';
  if (badge.condition_type === 'TOTAL_POINTS') return 'Points';
  return 'Milestone';
}

function conditionText(badge: Badge): string {
  if (badge.condition_type === 'STREAK_DAYS') {
    return `Maintain a streak of ${badge.condition_value} days`;
  }

  if (badge.condition_type === 'TOTAL_POINTS') {
    return `Earn ${badge.condition_value} XP`;
  }

  return `Complete ${badge.condition_value} check-in${
    badge.condition_value === 1 ? '' : 's'
  }`;
}

function Header({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
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
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text
            style={{
              color: colors.primary,
              fontSize: 27,
            }}
          >
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
    </View>
  );
}

function MiniStat({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: string;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.miniStat,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={{ fontSize: 19 }}>{icon}</Text>

      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{
          color: colors.ink,
          fontSize: 22,
          fontWeight: '900',
          marginTop: 6,
        }}
      >
        {value}
      </Text>

      <Text
        style={{
          color: colors.muted,
          fontSize: 11,
          marginTop: 3,
        }}
      >
        {title}
      </Text>
    </View>
  );
}

function BadgeTile({
  badge,
  onPress,
}: {
  badge: Badge;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  const progress = Math.max(0, badge.progress);
  const target = Math.max(1, badge.condition_value);
  const progressPercent = Math.min(
    100,
    Math.round((progress / target) * 100),
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${badge.name}, ${
        badge.unlocked
          ? 'unlocked'
          : `${Math.min(progress, target)} of ${badge.condition_value}`
      }. Tap for details.`}
      style={({ pressed }) => [
        styles.badgeTile,
        {
          backgroundColor: colors.card,
          borderColor: badge.unlocked
            ? colors.primaryTint
            : colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.badgeIconFrame,
          {
            backgroundColor: badge.unlocked
              ? colors.primaryTint
              : colors.surface,
          },
        ]}
      >
        <Text
          style={{
            fontSize: 29,
            opacity: badge.unlocked ? 1 : 0.55,
          }}
        >
          {badgeIcon(badge.code)}
        </Text>

        {badge.unlocked ? (
          <View
            style={[
              styles.checkMark,
              { backgroundColor: colors.success },
            ]}
          >
            <Text
              style={{
                color: '#FFFFFF',
                fontSize: 10,
                fontWeight: '900',
              }}
            >
              ✓
            </Text>
          </View>
        ) : null}
      </View>

      <Text
        style={[styles.badgeName, { color: colors.ink }]}
        numberOfLines={2}
      >
        {badge.name}
      </Text>

      <Text
        style={{
          color: badge.unlocked ? colors.primary : colors.muted,
          fontSize: 10,
          fontWeight: '800',
          marginTop: 6,
        }}
      >
        {badge.unlocked
          ? 'UNLOCKED'
          : `${Math.min(progress, target)} / ${badge.condition_value}`}
      </Text>

      {!badge.unlocked ? (
        <View
          style={[
            styles.badgeProgressTrack,
            { backgroundColor: colors.surface },
          ]}
        >
          <View
            style={[
              styles.badgeProgressFill,
              {
                width: `${progressPercent}%`,
                backgroundColor: colors.primary,
              },
            ]}
          />
        </View>
      ) : (
        <Text
          style={{
            color: colors.muted,
            fontSize: 10,
            marginTop: 7,
          }}
        >
          +50 XP reward
        </Text>
      )}
    </Pressable>
  );
}

export default function Gamification() {
  const { colors } = useTheme();

  const points = useQuery({
    queryKey: ['points'],
    queryFn: api.points.summary,
  });

  const badges = useQuery({
    queryKey: ['badges'],
    queryFn: api.badges.list,
  });

  const [galleryOpen, setGalleryOpen] = useState(false);
  const [filter, setFilter] = useState<BadgeFilter>('All');
  const [selected, setSelected] = useState<Badge | null>(null);

  const list = badges.data ?? [];
  const unlocked = list.filter((badge) => badge.unlocked);
  const locked = list.filter((badge) => !badge.unlocked);

  const visible = useMemo(
    () =>
      list.filter((badge) => {
        switch (filter) {
          case 'All':
            return true;
          case 'Unlocked':
            return badge.unlocked;
          case 'Locked':
            return !badge.unlocked;
          default:
            return category(badge) === filter;
        }
      }),
    [list, filter],
  );

  const currentXp = points.data?.total_points ?? 0;

  const nextAt =
    points.data?.next_level_at ??
    Math.max(
      100,
      currentXp + (points.data?.points_to_next_level ?? 100),
    );

  const levelBase = Math.max(
    0,
    nextAt - (points.data?.points_to_next_level ?? nextAt),
  );

  const levelProgress = Math.min(
    100,
    Math.max(
      0,
      nextAt > levelBase
        ? ((currentXp - levelBase) / (nextAt - levelBase)) * 100
        : 0,
    ),
  );

  const refreshing = points.isRefetching || badges.isRefetching;

  function refreshData() {
    void points.refetch();
    void badges.refetch();
  }

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      <Header
        title="Progress"
        subtitle="Celebrate every step forward"
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshData}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {(points.isLoading || badges.isLoading) && (
          <View
            style={[
              styles.loadingCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <ActivityIndicator
              color={colors.primary}
              size="large"
            />

            <Text
              style={{
                color: colors.muted,
                marginTop: 12,
              }}
            >
              Loading your achievements…
            </Text>
          </View>
        )}

        {(points.isError || badges.isError) && (
          <View
            style={[
              styles.loadingCard,
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
              {describeError(points.error ?? badges.error)}
            </Text>

            <Pressable
              onPress={refreshData}
              accessibilityRole="button"
              style={{ paddingTop: 14 }}
            >
              <Text
                style={{
                  color: colors.primary,
                  fontWeight: '800',
                }}
              >
                Try again
              </Text>
            </Pressable>
          </View>
        )}

        {points.data && (
          <>
            <View style={styles.xpCard}>
              <View style={styles.xpTop}>
                <View
                  style={[
                    styles.levelEmblem,
                    {
                      backgroundColor: 'rgba(255,255,255,0.16)',
                    },
                  ]}
                >
                  <Text style={{ fontSize: 31 }}>🏆</Text>
                </View>

                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: '#EDE9FE',
                      fontSize: 12,
                      fontWeight: '800',
                      letterSpacing: 0.8,
                    }}
                  >
                    YOUR JOURNEY
                  </Text>

                  <Text
                    style={{
                      color: '#FFFFFF',
                      fontSize: 25,
                      fontWeight: '900',
                      marginTop: 3,
                    }}
                  >
                    Level {points.data.level}
                  </Text>

                  <Text
                    style={{
                      color: '#EDE9FE',
                      fontSize: 12,
                      marginTop: 3,
                    }}
                  >
                    {currentXp.toLocaleString()} total XP earned
                  </Text>
                </View>

                <View style={styles.xpPill}>
                  <Text
                    style={{
                      color: '#FFFFFF',
                      fontWeight: '800',
                      fontSize: 12,
                    }}
                  >
                    ✨ XP
                  </Text>
                </View>
              </View>

              <View style={styles.xpProgressLabels}>
                <Text
                  style={{
                    color: '#FFFFFF',
                    fontSize: 12,
                    fontWeight: '800',
                  }}
                >
                  Level progress
                </Text>

                <Text
                  style={{
                    color: '#EDE9FE',
                    fontSize: 11,
                  }}
                >
                  {points.data.points_to_next_level} XP to next level
                </Text>
              </View>

              <View
                accessibilityRole="progressbar"
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: Math.round(levelProgress),
                }}
                style={styles.xpTrack}
              >
                <View
                  style={[
                    styles.xpFill,
                    { width: `${levelProgress}%` },
                  ]}
                />
              </View>

              <View style={styles.xpFoot}>
                <Text
                  style={{ color: '#EDE9FE', fontSize: 10 }}
                >
                  Level {points.data.level}
                </Text>

                <Text
                  style={{ color: '#EDE9FE', fontSize: 10 }}
                >
                  Level {points.data.level + 1}
                </Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              <MiniStat
                title="Check-ins"
                value={String(points.data.checkins)}
                icon="✅"
              />

              <MiniStat
                title="Badges earned"
                value={String(points.data.badges_unlocked)}
                icon="🏅"
              />

              <MiniStat
                title="Still locked"
                value={String(locked.length)}
                icon="🔒"
              />
            </View>
          </>
        )}

        <View style={styles.sectionHeader}>
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.ink },
              ]}
            >
              Badge gallery
            </Text>

            <Text
              style={{
                color: colors.muted,
                fontSize: 12,
                marginTop: 4,
              }}
            >
              Every achievement tells a story.
            </Text>
          </View>

          <Pressable
            onPress={() => {
              setFilter('All');
              setGalleryOpen(true);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="View all badges"
          >
            <Text
              style={{
                color: colors.primary,
                fontWeight: '800',
                fontSize: 13,
              }}
            >
              View all ›
            </Text>
          </Pressable>
        </View>

        {badges.data && list.length === 0 && (
          <View
            style={[
              styles.loadingCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={{ fontSize: 34 }}>🏅</Text>

            <Text
              style={[
                styles.badgeName,
                {
                  color: colors.ink,
                  fontSize: 16,
                  marginTop: 10,
                },
              ]}
            >
              Your first badge is waiting
            </Text>

            <Text
              style={{
                color: colors.muted,
                fontSize: 12,
                lineHeight: 19,
                textAlign: 'center',
                marginTop: 6,
              }}
            >
              Keep checking in on your habits to unlock achievements.
            </Text>
          </View>
        )}

        {unlocked.length > 0 && (
          <>
            <View style={styles.listSectionHeader}>
              <Text
                style={[
                  styles.overline,
                  { color: colors.muted },
                ]}
              >
                RECENT UNLOCKS
              </Text>

              <Text
                style={{
                  color: colors.primary,
                  fontSize: 11,
                  fontWeight: '800',
                }}
              >
                {unlocked.length} earned
              </Text>
            </View>

            <View style={styles.badgeGrid}>
              {unlocked.slice(0, 4).map((badge) => (
                <View
                  key={badge.badge_id}
                  style={styles.badgeGridItem}
                >
                  <BadgeTile
                    badge={badge}
                    onPress={() => setSelected(badge)}
                  />
                </View>
              ))}
            </View>
          </>
        )}

        {locked.length > 0 && (
          <>
            <View style={styles.listSectionHeader}>
              <Text
                style={[
                  styles.overline,
                  { color: colors.muted },
                ]}
              >
                NEXT TO UNLOCK
              </Text>

              <Text
                style={{
                  color: colors.muted,
                  fontSize: 11,
                }}
              >
                {locked.length} waiting
              </Text>
            </View>

            <View style={styles.badgeGrid}>
              {locked.slice(0, 4).map((badge) => (
                <View
                  key={badge.badge_id}
                  style={styles.badgeGridItem}
                >
                  <BadgeTile
                    badge={badge}
                    onPress={() => setSelected(badge)}
                  />
                </View>
              ))}
            </View>
          </>
        )}

        <View
          style={[
            styles.encouragement,
            { backgroundColor: colors.primaryTint },
          ]}
        >
          <Text style={{ fontSize: 26 }}>🌱</Text>

          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.primary,
                fontWeight: '800',
                fontSize: 13,
              }}
            >
              Consistency over perfection
            </Text>

            <Text
              style={{
                color: colors.muted,
                fontSize: 12,
                lineHeight: 18,
                marginTop: 4,
              }}
            >
              Every check-in is progress. Keep taking small steps.
            </Text>
          </View>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Complete badge gallery */}
      <Modal
        visible={galleryOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setGalleryOpen(false)}
      >
        <SafeAreaView
          style={[styles.screen, { backgroundColor: colors.bg }]}
          edges={['top']}
        >
          <Header
            title="Badge gallery"
            subtitle={`${unlocked.length} of ${list.length} unlocked`}
            onBack={() => setGalleryOpen(false)}
          />

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {FILTERS.map((item) => {
                const active = filter === item;

                return (
                  <Pressable
                    key={item}
                    onPress={() => setFilter(item)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: active
                          ? colors.primary
                          : colors.card,
                        borderColor: active
                          ? colors.primary
                          : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: active ? '#FFFFFF' : colors.muted,
                        fontWeight: '800',
                        fontSize: 12,
                      }}
                    >
                      {item}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text
              style={{
                color: colors.muted,
                fontSize: 12,
                marginBottom: 12,
              }}
            >
              {visible.length} achievement
              {visible.length === 1 ? '' : 's'}
            </Text>

            <View style={styles.badgeGrid}>
              {visible.map((badge) => (
                <View
                  key={badge.badge_id}
                  style={styles.badgeGridItem}
                >
                  <BadgeTile
                    badge={badge}
                    onPress={() => setSelected(badge)}
                  />
                </View>
              ))}
            </View>

            {visible.length === 0 && (
              <Text
                style={{
                  color: colors.muted,
                  textAlign: 'center',
                  paddingTop: 40,
                }}
              >
                No badges in this category yet.
              </Text>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Selected badge details */}
      <Modal
        visible={selected !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setSelected(null)}
            accessibilityLabel="Close badge details"
            accessibilityRole="button"
          />

          <View
            style={[
              styles.sheet,
              { backgroundColor: colors.card },
            ]}
          >
            <View
              style={[
                styles.sheetHandle,
                { backgroundColor: colors.border },
              ]}
            />

            {selected && (
              <>
                <View
                  style={[
                    styles.sheetBadge,
                    {
                      backgroundColor: selected.unlocked
                        ? colors.primaryTint
                        : colors.surface,
                    },
                  ]}
                >
                  <Text style={{ fontSize: 42 }}>
                    {badgeIcon(selected.code)}
                  </Text>
                </View>

                <Text
                  style={[
                    styles.sheetTitle,
                    { color: colors.ink },
                  ]}
                >
                  {selected.name}
                </Text>

                <Text
                  style={{
                    color: colors.primary,
                    fontWeight: '800',
                    fontSize: 11,
                    marginTop: 6,
                    letterSpacing: 0.7,
                  }}
                >
                  {category(selected).toUpperCase()}
                </Text>

                <Text
                  style={{
                    color: colors.muted,
                    fontSize: 13,
                    lineHeight: 20,
                    textAlign: 'center',
                    marginTop: 14,
                  }}
                >
                  {selected.description}
                </Text>

                <View
                  style={[
                    styles.conditionCard,
                    {
                      backgroundColor: colors.bg,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: colors.muted,
                      fontSize: 11,
                      fontWeight: '800',
                      letterSpacing: 0.4,
                    }}
                  >
                    {selected.unlocked
                      ? 'ACHIEVEMENT UNLOCKED'
                      : 'HOW TO UNLOCK'}
                  </Text>

                  <Text
                    style={{
                      color: colors.ink,
                      fontSize: 14,
                      fontWeight: '700',
                      lineHeight: 21,
                      marginTop: 7,
                    }}
                  >
                    {conditionText(selected)}
                  </Text>

                  {!selected.unlocked ? (
                    <>
                      <View
                        style={[
                          styles.badgeProgressTrack,
                          {
                            backgroundColor: colors.surface,
                            marginTop: 13,
                            height: 7,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.badgeProgressFill,
                            {
                              height: 7,
                              width: `${Math.min(
                                100,
                                Math.max(
                                  0,
                                  (selected.progress /
                                    Math.max(
                                      1,
                                      selected.condition_value,
                                    )) *
                                    100,
                                ),
                              )}%`,
                              backgroundColor: colors.primary,
                            },
                          ]}
                        />
                      </View>

                      <Text
                        style={{
                          color: colors.muted,
                          fontSize: 11,
                          marginTop: 7,
                        }}
                      >
                        {Math.min(
                          Math.max(0, selected.progress),
                          selected.condition_value,
                        )}{' '}
                        of {selected.condition_value}
                      </Text>
                    </>
                  ) : (
                    <Text
                      style={{
                        color: colors.success,
                        fontSize: 12,
                        fontWeight: '700',
                        marginTop: 8,
                      }}
                    >
                      {selected.unlocked_at
                        ? `Unlocked ${new Date(
                            selected.unlocked_at,
                          ).toLocaleDateString()}`
                        : 'Unlocked'}{' '}
                      · +50 XP
                    </Text>
                  )}
                </View>

                <Button
                  label="Got it"
                  onPress={() => setSelected(null)}
                  style={{
                    marginTop: 18,
                    alignSelf: 'stretch',
                  }}
                />
              </>
            )}
          </View>
        </View>
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
  },

  loadingCard: {
    alignItems: 'center',
    padding: 28,
    borderRadius: radius.card,
    borderWidth: 1,
    marginBottom: 14,
  },

  xpCard: {
    borderRadius: 21,
    padding: 19,
    backgroundColor: '#7C3AED',
    marginBottom: 14,
    shadowColor: '#6D28D9',
    shadowOpacity: 0.18,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 7 },
    elevation: 3,
  },

  xpTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },

  levelEmblem: {
    width: 60,
    height: 60,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  xpPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },

  xpProgressLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 22,
    marginBottom: 9,
  },

  xpTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.23)',
    overflow: 'hidden',
  },

  xpFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },

  xpFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },

  statsRow: {
    flexDirection: 'row',
    gap: 9,
    marginBottom: 27,
  },

  miniStat: {
    flex: 1,
    minWidth: 0,
    padding: 11,
    borderRadius: 15,
    borderWidth: 1,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },

  sectionTitle: {
    fontSize: 17,
    fontWeight: '900',
  },

  listSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 11,
  },

  overline: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },

  badgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
    marginBottom: 23,
  },

  badgeGridItem: {
    width: '48%',
  },

  badgeTile: {
    minHeight: 174,
    borderRadius: 17,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },

  badgeIconFrame: {
    width: 65,
    height: 65,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },

  checkMark: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 19,
    height: 19,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },

  badgeName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 10,
  },

  badgeProgressTrack: {
    width: '100%',
    height: 4,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 8,
  },

  badgeProgressFill: {
    height: 4,
    borderRadius: 3,
  },

  encouragement: {
    borderRadius: 16,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 16,
  },

  filterChip: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },

  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(24,17,31,0.45)',
    justifyContent: 'flex-end',
  },

  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 28,
    alignItems: 'center',
  },

  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 24,
  },

  sheetBadge: {
    width: 88,
    height: 88,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sheetTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 17,
  },

  conditionCard: {
    alignSelf: 'stretch',
    marginTop: 19,
    borderRadius: 15,
    borderWidth: 1,
    padding: 14,
  },
});
