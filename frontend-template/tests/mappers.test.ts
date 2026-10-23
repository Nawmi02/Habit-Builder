import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apiActionFor,
  apiDaysToUi,
  colorKeyToHex,
  draftToHabitWrite,
  habitToDraft,
  hexToColorKey,
  isSuccess,
  moodFromApi,
  moodToApi,
  requiresSkipReason,
  statusText,
  tint,
  uiDaysToApi,
  type HabitDraft,
} from '../src/api/mappers';
import { describeError, ApiError, NetworkError } from '../src/api/errors';
import { flattenChecklist, greeting, progressOf } from '../src/lib/checklist';
import type { Checklist, ChecklistItem, Habit } from '../src/api/types';

const baseDraft: HabitDraft = {
  name: '  Drink Water ',
  emoji: '💧',
  colorKey: 'cyan',
  habitType: 'build',
  targetType: 'count',
  durationEnabled: false,
  targetCount: 1,
  targetDuration: 10,
  frequency: 'daily',
  customDays: [],
  reminderEnabled: true,
  reminderTimes: ['07:30'],
  reminderTone: 'DEFAULT',
  timeOfDay: 'Morning',
};

test('weekdays: prototype Sunday=0 <-> backend Monday=0', () => {
  // UI: Sun=0 Mon=1 ... Sat=6   API: Mon=0 ... Sun=6
  assert.deepEqual(uiDaysToApi([0]), [6], 'Sunday');
  assert.deepEqual(uiDaysToApi([1]), [0], 'Monday');
  assert.deepEqual(uiDaysToApi([6]), [5], 'Saturday');
  assert.deepEqual(uiDaysToApi([1, 3, 5]), [0, 2, 4], 'Mon Wed Fri');
  assert.deepEqual(uiDaysToApi([3, 3, 1, 99, -1]), [0, 2], 'dedupes, sorts, drops invalid');
  for (let d = 0; d < 7; d++) assert.deepEqual(apiDaysToUi(uiDaysToApi([d])), [d], `round trip ${d}`);
});

test('draft -> API payload: daily count habit', () => {
  const w = draftToHabitWrite(baseDraft, '2026-10-20');
  assert.equal(w.name, 'Drink Water', 'trimmed');
  assert.equal(w.habit_type, 'GOOD');
  assert.equal(w.color, '#22D3EE');
  assert.equal(w.target_type, 'COUNT');
  assert.equal(w.target_value, 1);
  assert.equal(w.time_of_day, 'MORNING');
  assert.equal(w.start_date, '2026-10-20');
  assert.deepEqual(w.schedule, { frequency_type: 'DAILY', weekdays: [], reminder_time: '07:30:00', reminder_times: ['07:30:00'], reminder_tone: 'DEFAULT', skip_allowed: true });
});

test('draft -> API payload: custom frequency converts the selected day numbers', () => {
  const custom = draftToHabitWrite({ ...baseDraft, frequency: 'custom', customDays: [0, 6] }, 'x'); // Sun + Sat
  assert.equal(custom.schedule.frequency_type, 'WEEKDAYS');
  assert.deepEqual(custom.schedule.weekdays, [5, 6]);
  // never TIMES_PER_WEEK (backend bug)
  assert.notEqual(custom.schedule.frequency_type, 'TIMES_PER_WEEK');
});

test('draft -> API payload: count and duration targets, reminder off => null', () => {
  const c = draftToHabitWrite({ ...baseDraft, targetType: 'count', targetCount: 8 }, 'x');
  assert.deepEqual([c.target_type, c.target_value, c.target_unit], ['COUNT', 8, 'times']);
  const d = draftToHabitWrite({ ...baseDraft, targetType: 'duration', targetDuration: 30, reminderEnabled: false }, 'x');
  assert.deepEqual([d.target_type, d.target_value, d.target_unit], ['DURATION', 30, 'min']);
  assert.equal(d.schedule.reminder_time, null);
  assert.deepEqual(d.schedule.reminder_times, []);
  const zeroDuration = draftToHabitWrite({ ...baseDraft, targetType: 'duration', targetDuration: 0 }, 'x');
  assert.equal(zeroDuration.target_value, 0, 'duration may be zero');
  const zero = draftToHabitWrite({ ...baseDraft, targetType: 'count', targetCount: 0 }, 'x');
  assert.equal(zero.target_value, 1, 'backend needs a positive target');
});

function baseDraftHabit() {
  const w = draftToHabitWrite(baseDraft, '2026-10-20');
  return {
    habit_id: 1, user_id: 1, status: 'ACTIVE', created_at: '', updated_at: '',
    ...w,
    schedule: { schedule_id: 1, habit_id: 1, times_per_week: null, target_time: null, pause_start: null, pause_end: null, max_skip_per_period: null, ...w.schedule },
  };
}

test('API habit -> draft round trip (break habit, custom days, reminder)', () => {
  const written = draftToHabitWrite({ ...baseDraft, frequency: 'custom', customDays: [1, 3, 5], habitType: 'break' }, '2026-10-20');
  const habit = {
    habit_id: 1, user_id: 1, status: 'ACTIVE', created_at: '', updated_at: '',
    ...written,
    schedule: { schedule_id: 1, habit_id: 1, times_per_week: null, target_time: null, pause_start: null, pause_end: null, max_skip_per_period: null, ...written.schedule },
  } as unknown as Habit;
  const back = habitToDraft(habit);
  assert.deepEqual(back.customDays, [1, 3, 5]);
  assert.equal(back.frequency, 'custom');
  assert.equal(back.habitType, 'break');
  assert.equal(back.colorKey, 'cyan');
  assert.deepEqual(back.reminderTimes, ['07:30']);
  assert.equal(back.reminderEnabled, true);
});

test('API habit -> draft: Mon-Fri recognised as "weekdays"; TIMES_PER_WEEK degrades to custom/no days', () => {
  const mk = (frequency_type: string, weekdays: number[]) =>
    ({ ...baseDraftHabit(), schedule: { ...baseDraftHabit().schedule, frequency_type, weekdays } }) as unknown as Habit;
  assert.equal(habitToDraft(mk('WEEKDAYS', [4, 3, 2, 1, 0])).frequency, 'weekdays');
  const tpw = habitToDraft(mk('TIMES_PER_WEEK', []));
  assert.equal(tpw.frequency, 'custom');
  assert.deepEqual(tpw.customDays, []);
});

test('colours: key <-> hex, unknown falls back to purple, tint()', () => {
  assert.equal(colorKeyToHex('teal'), '#2DD4BF');
  assert.equal(hexToColorKey('#2dd4bf'), 'teal', 'case-insensitive');
  assert.equal(hexToColorKey('#123456'), 'purple');
  assert.equal(colorKeyToHex('nope'), '#A78BFA');
  assert.equal(tint('#22D3EE', 0.2), 'rgba(34,211,238,0.2)');
});

test('mood: all five map both ways, unknown/empty is undefined', () => {
  for (const m of ['Great', 'Good', 'Okay', 'Bad', 'Awful'] as const) assert.equal(moodFromApi(moodToApi(m)), m);
  assert.equal(moodToApi('Okay'), 'NEUTRAL');
  assert.equal(moodFromApi(''), undefined);
  assert.equal(moodFromApi('???'), undefined);
});

test('BAD habits invert the check-in: avoiding = skip endpoint, slipping = complete endpoint', () => {
  assert.equal(apiActionFor('GOOD', 'success'), 'complete');
  assert.equal(apiActionFor('GOOD', 'skip'), 'skip');
  assert.equal(apiActionFor('GOOD', 'slip'), null);
  assert.equal(apiActionFor('BAD', 'success'), 'skip');
  assert.equal(apiActionFor('BAD', 'slip'), 'complete');
  assert.equal(apiActionFor('BAD', 'skip'), null);
});

test('skip reason is required only for skipping a GOOD habit', () => {
  assert.equal(requiresSkipReason('GOOD', 'skip'), true);
  assert.equal(requiresSkipReason('BAD', 'skip'), false, 'avoiding a bad habit needs no excuse');
  assert.equal(requiresSkipReason('GOOD', 'complete'), false);
});

test('isSuccess respects inversion', () => {
  assert.equal(isSuccess('GOOD', 'COMPLETED'), true);
  assert.equal(isSuccess('GOOD', 'SKIPPED'), false);
  assert.equal(isSuccess('BAD', 'SKIPPED'), true);
  assert.equal(isSuccess('BAD', 'COMPLETED'), false);
});

test('statusText: BAD habits read "Avoided"/"Slipped", GOOD read "Done"/"Skipped"', () => {
  assert.equal(statusText('GOOD', 'COMPLETED'), 'Done');
  assert.equal(statusText('GOOD', 'SKIPPED'), 'Skipped');
  assert.equal(statusText('BAD', 'SKIPPED'), 'Avoided');
  assert.equal(statusText('BAD', 'COMPLETED'), 'Slipped');
  assert.equal(statusText('BAD', 'PENDING'), 'Check in');
});

test('describeError covers API, network, timeout and unknown errors', () => {
  assert.equal(describeError(new ApiError(401, 'Incorrect password')), 'Incorrect password');
  assert.match(describeError(new NetworkError()), /cannot reach/i);
  assert.match(describeError(new NetworkError('x', true)), /too long/i);
  assert.match(describeError(new Error('boom')), /something went wrong/i);
});

test('checklist: flattened in time-of-day order, progress counts skipped as handled', () => {
  const mk = (id: number, tod: ChecklistItem['time_of_day']) => ({ occurrence_id: id, time_of_day: tod }) as ChecklistItem;
  const c = {
    date: 'x',
    summary: { total: 4, completed: 1, pending: 2, missed: 0, skipped: 1, percent: 25 },
    groups: { MORNING: [mk(1, 'MORNING')], AFTERNOON: [], EVENING: [mk(3, 'EVENING')], ANYTIME: [mk(4, 'ANYTIME'), mk(2, 'ANYTIME')] },
  } as Checklist;
  assert.deepEqual(flattenChecklist(c).map((i) => i.occurrence_id), [1, 3, 4, 2]);
  assert.deepEqual(flattenChecklist(undefined), []);
  assert.deepEqual(progressOf(c.summary), { done: 2, total: 4, fraction: 0.5 });
  assert.deepEqual(progressOf(undefined), { done: 0, total: 0, fraction: 0 });
  assert.equal(greeting(new Date(2026, 0, 1, 9)), 'Good morning');
  assert.equal(greeting(new Date(2026, 0, 1, 14)), 'Good afternoon');
  assert.equal(greeting(new Date(2026, 0, 1, 20)), 'Good evening');
});
