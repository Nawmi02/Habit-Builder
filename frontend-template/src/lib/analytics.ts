/**
 * Analytics computed on the client, because the backend has NO analytics endpoints yet.
 * Input is the occurrence history from GET /habits/{id}/occurrences/?from=&to= (one call per
 * habit). If the backend team adds /analytics/* endpoints later, replace this file's callers
 * and keep the functions as a fallback / for offline use.
 *
 * Rules (match the PRD: skipped days don't count for or against you):
 *   GOOD habit: COMPLETED = success | MISSED = fail | SKIPPED = excluded
 *   BAD  habit: SKIPPED  = success (you avoided it) | COMPLETED = fail (you slipped) | MISSED = fail
 *   PENDING in the past = fail (the nightly job just hasn't marked it MISSED yet)
 *   PENDING today/future = still open, not counted
 */

import type { HabitType, OccurrenceStatus } from '../api/types';
import { addDays, eachDay, shortDayName, weekdayMon0 } from './dates';

export interface AnalyticsRow {
  habitId: number;
  habitType: HabitType;
  date: string; // YYYY-MM-DD
  status: OccurrenceStatus;
}

export type Outcome = 'success' | 'fail' | 'excluded' | 'open';

export function classify(row: AnalyticsRow, today: string): Outcome {
  const { habitType, status, date } = row;
  if (status === 'PENDING') return date < today ? 'fail' : 'open';
  if (status === 'MISSED') return 'fail';
  if (habitType === 'GOOD') return status === 'COMPLETED' ? 'success' : 'excluded';
  return status === 'SKIPPED' ? 'success' : 'fail';
}

export interface Tally {
  success: number;
  fail: number;
  total: number; // success + fail (what the rate is computed over)
}

function tally(rows: AnalyticsRow[], today: string): Tally {
  let success = 0;
  let fail = 0;
  for (const r of rows) {
    const o = classify(r, today);
    if (o === 'success') success++;
    else if (o === 'fail') fail++;
  }
  return { success, fail, total: success + fail };
}

/** 0..1, or null when there's nothing to measure yet (don't show "0%" for no data). */
export function completionRate(rows: AnalyticsRow[], today: string): number | null {
  const t = tally(rows, today);
  return t.total === 0 ? null : t.success / t.total;
}

export interface DayBar extends Tally {
  date: string;
  label: string; // Mon..Sun
  rate: number | null;
  isToday: boolean;
}

/** Seven bars for the week starting on `weekStart` (a Monday). */
export function weeklyBars(rows: AnalyticsRow[], weekStart: string, today: string): DayBar[] {
  const byDate = new Map<string, AnalyticsRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const t = tally(byDate.get(date) ?? [], today);
    return { ...t, date, label: shortDayName(date), rate: t.total ? t.success / t.total : null, isToday: date === today };
  });
}

export type Intensity = 0 | 1 | 2 | 3 | 4;

/** Heatmap colour step: 0 = nothing, 4 = everything done. */
export function intensity(success: number, total: number): Intensity {
  if (total <= 0 || success <= 0) return 0;
  const r = success / total;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r < 1) return 3;
  return 4;
}

export interface HeatCell {
  date: string;
  weekday: number; // Monday = 0
  intensity: Intensity;
  outcome: 'success' | 'fail' | 'none';
}

/** One cell per calendar day from..to inclusive (gaps = no scheduled habit that day). */
export function heatmap(rows: AnalyticsRow[], from: string, to: string, today: string): HeatCell[] {
  const byDate = new Map<string, AnalyticsRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }
  return eachDay(from, to).map((date) => {
    const t = tally(byDate.get(date) ?? [], today);
    return {
      date,
      weekday: weekdayMon0(date),
      intensity: intensity(t.success, t.total),
      outcome: t.total === 0 ? 'none' : t.success === t.total ? 'success' : 'fail',
    };
  });
}

export interface HabitRate extends Tally {
  habitId: number;
  rate: number | null;
}

/** Per-habit rates, best first; habits with no data sink to the bottom. */
export function habitRates(rows: AnalyticsRow[], today: string): HabitRate[] {
  const groups = new Map<number, AnalyticsRow[]>();
  for (const r of rows) {
    const list = groups.get(r.habitId);
    if (list) list.push(r);
    else groups.set(r.habitId, [r]);
  }
  return [...groups.entries()]
    .map(([habitId, list]) => {
      const t = tally(list, today);
      return { habitId, ...t, rate: t.total ? t.success / t.total : null };
    })
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.total - a.total);
}

/** Overall rate for a set of bars (the big "74%" number). */
export function overallRate(bars: DayBar[]): number | null {
  const success = bars.reduce((n, b) => n + b.success, 0);
  const total = bars.reduce((n, b) => n + b.total, 0);
  return total ? success / total : null;
}
