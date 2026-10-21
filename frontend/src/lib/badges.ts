/**
 * Badges.
 *
 * The backend returns no icon and does NOT tell us in the complete-response that a badge was
 * just unlocked. So:
 *   1. snapshot GET /badges/ before the check-in
 *   2. do the check-in
 *   3. fetch GET /badges/ again and call newlyUnlocked(before, after)
 * If it returns badges -> show the Badge Unlock celebration (Member 3's component).
 *
 * (Ask for `new_badges` in the complete response to remove the extra request - see report.)
 */

import type { Badge } from '../api/types';

/** Icons by backend `code`. Unknown codes fall back to a medal. */
const ICONS: Record<string, string> = {
  'first-checkin': '⭐',
  'streak-7': '🔥',
  'streak-30': '🏆',
  'checkins-100': '💯',
};

export const badgeIcon = (code: string): string => ICONS[code] ?? '🏅';

/**
 * Badges that are unlocked in `after` but weren't in `before`.
 * If `before` is empty (first load, nothing cached) we return [] on purpose - otherwise a
 * returning user would get celebrations for everything they already own.
 */
export function newlyUnlocked(before: Badge[], after: Badge[]): Badge[] {
  if (before.length === 0) return [];
  const had = new Set(before.filter((b) => b.unlocked).map((b) => b.badge_id));
  return after.filter((b) => b.unlocked && !had.has(b.badge_id));
}
