import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, completionRate, habitRates, heatmap, intensity, overallRate, weeklyBars, type AnalyticsRow } from '../src/lib/analytics';
import { addDays, daysBetween, eachDay, startOfWeek, toDateString, weekdayMon0 } from '../src/lib/dates';
import { badgeIcon, newlyUnlocked } from '../src/lib/badges';
import type { Badge } from '../src/api/types';

const TODAY = '2026-10-21'; // a Wednesday
const row = (date: string, status: AnalyticsRow['status'], habitType: AnalyticsRow['habitType'] = 'GOOD', habitId = 1): AnalyticsRow => ({
  habitId, habitType, date, status,
});

test('dates: weekday numbering, week start, month/year/DST-safe arithmetic', () => {
  assert.equal(weekdayMon0('2026-10-19'), 0, 'Monday');
  assert.equal(weekdayMon0('2026-10-25'), 6, 'Sunday');
  assert.equal(startOfWeek('2026-10-21'), '2026-10-19');
  assert.equal(startOfWeek('2026-10-25'), '2026-10-19', 'Sunday belongs to the week that started Monday');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29', 'leap year');
  assert.equal(daysBetween('2026-10-01', '2026-10-31'), 30);
  assert.deepEqual(eachDay('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.equal(toDateString(new Date(2026, 0, 5)), '2026-01-05');
});

test('classify: GOOD habit', () => {
  assert.equal(classify(row('2026-10-20', 'COMPLETED'), TODAY), 'success');
  assert.equal(classify(row('2026-10-20', 'MISSED'), TODAY), 'fail');
  assert.equal(classify(row('2026-10-20', 'SKIPPED'), TODAY), 'excluded');
  assert.equal(classify(row('2026-10-20', 'PENDING'), TODAY), 'fail', 'past pending = not done in time');
  assert.equal(classify(row(TODAY, 'PENDING'), TODAY), 'open', 'today still has time');
  assert.equal(classify(row('2026-10-22', 'PENDING'), TODAY), 'open');
});

test('classify: BAD habit is inverted (skip = avoided = success, complete = slipped = fail)', () => {
  assert.equal(classify(row('2026-10-20', 'SKIPPED', 'BAD'), TODAY), 'success');
  assert.equal(classify(row('2026-10-20', 'COMPLETED', 'BAD'), TODAY), 'fail');
  assert.equal(classify(row('2026-10-20', 'MISSED', 'BAD'), TODAY), 'fail');
});

test('completionRate: skipped excluded, open excluded, no data -> null (not 0%)', () => {
  const rows = [row('2026-10-19', 'COMPLETED'), row('2026-10-20', 'COMPLETED'), row('2026-10-18', 'MISSED'), row('2026-10-17', 'SKIPPED'), row(TODAY, 'PENDING')];
  assert.equal(completionRate(rows, TODAY), 2 / 3);
  assert.equal(completionRate([], TODAY), null);
  assert.equal(completionRate([row('2026-10-17', 'SKIPPED')], TODAY), null, 'only skips = nothing measurable');
});

test('weeklyBars: 7 bars Mon..Sun, per-day rate, today flagged, empty days are null', () => {
  const rows = [
    row('2026-10-19', 'COMPLETED', 'GOOD', 1), row('2026-10-19', 'COMPLETED', 'GOOD', 2),
    row('2026-10-20', 'COMPLETED', 'GOOD', 1), row('2026-10-20', 'MISSED', 'GOOD', 2),
    row(TODAY, 'PENDING', 'GOOD', 1),
  ];
  const bars = weeklyBars(rows, '2026-10-19', TODAY);
  assert.equal(bars.length, 7);
  assert.deepEqual(bars.map((b) => b.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.equal(bars[0].rate, 1);
  assert.equal(bars[1].rate, 0.5);
  assert.equal(bars[2].rate, null, 'today is still open');
  assert.equal(bars[2].isToday, true);
  assert.equal(bars[5].rate, null);
  assert.equal(overallRate(bars), 3 / 4);
});

test('intensity steps', () => {
  assert.equal(intensity(0, 0), 0);
  assert.equal(intensity(0, 3), 0);
  assert.equal(intensity(1, 4), 1);
  assert.equal(intensity(2, 4), 2);
  assert.equal(intensity(3, 4), 3);
  assert.equal(intensity(4, 4), 4);
});

test('heatmap: one cell per day, gaps are "none"', () => {
  const cells = heatmap([row('2026-10-19', 'COMPLETED'), row('2026-10-21', 'MISSED')], '2026-10-19', '2026-10-21', TODAY);
  assert.equal(cells.length, 3);
  assert.deepEqual(cells.map((c) => c.outcome), ['success', 'none', 'fail']);
  assert.equal(cells[0].intensity, 4);
  assert.equal(cells[0].weekday, 0);
});

test('habitRates: sorted best first, no-data habits last', () => {
  const rows = [
    row('2026-10-19', 'COMPLETED', 'GOOD', 1), row('2026-10-20', 'MISSED', 'GOOD', 1),
    row('2026-10-19', 'COMPLETED', 'GOOD', 2), row('2026-10-20', 'COMPLETED', 'GOOD', 2),
    row('2026-10-19', 'SKIPPED', 'GOOD', 3),
  ];
  assert.deepEqual(habitRates(rows, TODAY).map((h) => [h.habitId, h.rate]), [[2, 1], [1, 0.5], [3, null]]);
});

const badge = (id: number, unlocked: boolean): Badge => ({
  badge_id: id, code: `b${id}`, name: `B${id}`, description: '', condition_type: 'TOTAL_CHECKINS', condition_value: 1, unlocked, unlocked_at: null, progress: 0,
});

test('newlyUnlocked: detects only fresh unlocks, never celebrates on first load', () => {
  assert.deepEqual(newlyUnlocked([badge(1, true), badge(2, false)], [badge(1, true), badge(2, true)]).map((b) => b.badge_id), [2]);
  assert.deepEqual(newlyUnlocked([badge(1, true)], [badge(1, true)]), []);
  assert.deepEqual(newlyUnlocked([], [badge(1, true), badge(2, true)]), [], 'empty "before" = first load');
  assert.equal(badgeIcon('streak-7'), '🔥');
  assert.equal(badgeIcon('unknown-code'), '🏅');
});
