/**
 * Translation layer between the PROTOTYPE's vocabulary (what the screens think in) and the
 * BACKEND's vocabulary (what the API speaks). Every mismatch we found lives here, in one
 * place, with tests - so screens never convert anything themselves.
 *
 * Mismatches handled:
 *  1. Weekdays: prototype 0 = SUNDAY (S M T W T F S), backend 0 = MONDAY.
 *  2. Habit "kind": prototype build/break  <->  GOOD/BAD.
 *  3. Frequency: prototype daily/weekdays/custom  <->  DAILY / WEEKDAYS(+list). We never send
 *     TIMES_PER_WEEK (backend bug: it only ever creates 1 occurrence per week - see report).
 *  4. Colour: prototype uses a key ("purple"), backend stores "#RRGGBB".
 *  5. Mood: prototype Great/Good/Okay/Bad/Awful  <->  GREAT/GOOD/NEUTRAL/LOW/BAD.
 *  6. Reminder time: "HH:MM" <-> "HH:MM:SS"; "disabled" == null on the server.
 *  7. BAD habits INVERT the check-in: avoiding it = POST skip (counts as success),
 *     slipping = POST complete. See apiActionFor().
 */

import type {
  ApiMood,
  Habit,
  HabitType,
  HabitWrite,
  OccurrenceStatus,
  TargetType,
  TimeOfDay,
} from './types';

// ---------- UI vocabulary (mirrors the prototype's types) ----------

export type UiHabitKind = 'build' | 'break';
export type UiTargetType = 'yesNo' | 'count' | 'duration';
export type UiFrequency = 'daily' | 'weekdays' | 'custom';
export type UiTimeOfDay = 'Morning' | 'Afternoon' | 'Evening' | 'Anytime';
export type UiMood = 'Great' | 'Good' | 'Okay' | 'Bad' | 'Awful';
export type UiStatus = 'pending' | 'done' | 'skipped' | 'missed';

/** The wizard's form state - same fields as the prototype's HabitDraft. */
export interface HabitDraft {
  name: string;
  emoji: string;
  colorKey: string;
  habitType: UiHabitKind;
  targetType: UiTargetType;
  targetCount: number;
  targetDuration: number; // minutes
  frequency: UiFrequency;
  customDays: number[]; // UI numbering: 0 = Sunday
  reminderEnabled: boolean;
  reminderTime: string; // "HH:MM"
  timeOfDay: UiTimeOfDay;
}

// ---------- colours (hex values copied from the prototype's habitColors) ----------

export const HABIT_COLORS = [
  { key: 'cyan', hex: '#22D3EE', label: 'Cyan' },
  { key: 'orange', hex: '#FB923C', label: 'Orange' },
  { key: 'purple', hex: '#A78BFA', label: 'Purple' },
  { key: 'green', hex: '#34D399', label: 'Green' },
  { key: 'red', hex: '#F87171', label: 'Red' },
  { key: 'gray', hex: '#9CA3AF', label: 'Grey' },
  { key: 'blue', hex: '#60A5FA', label: 'Blue' },
  { key: 'pink', hex: '#F472B6', label: 'Pink' },
  { key: 'amber', hex: '#FBBF24', label: 'Amber' },
  { key: 'lime', hex: '#A3E635', label: 'Lime' },
  { key: 'indigo', hex: '#818CF8', label: 'Indigo' },
  { key: 'teal', hex: '#2DD4BF', label: 'Teal' },
] as const;

export function colorKeyToHex(key: string): string {
  return (HABIT_COLORS.find((c) => c.key === key) ?? HABIT_COLORS[2]).hex;
}

export function hexToColorKey(hex: string): string {
  const wanted = hex.trim().toUpperCase();
  return (HABIT_COLORS.find((c) => c.hex === wanted) ?? HABIT_COLORS[2]).key;
}

/** A light tint of a habit colour for tile backgrounds ("#22D3EE" -> "rgba(34,211,238,0.18)"). */
export function tint(hex: string, alpha = 0.18): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return `rgba(124,58,237,${alpha})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

// ---------- weekdays ----------

/** UI (0 = Sunday) -> API (0 = Monday). Sorted, de-duplicated, invalid values dropped. */
export function uiDaysToApi(days: number[]): number[] {
  const out = new Set<number>();
  for (const d of days) if (Number.isInteger(d) && d >= 0 && d <= 6) out.add((d + 6) % 7);
  return [...out].sort((a, b) => a - b);
}

/** API (0 = Monday) -> UI (0 = Sunday). */
export function apiDaysToUi(days: number[]): number[] {
  const out = new Set<number>();
  for (const d of days) if (Number.isInteger(d) && d >= 0 && d <= 6) out.add((d + 1) % 7);
  return [...out].sort((a, b) => a - b);
}

const MON_TO_FRI = [0, 1, 2, 3, 4];

// ---------- small enum maps ----------

export const habitTypeToApi = (k: UiHabitKind): HabitType => (k === 'build' ? 'GOOD' : 'BAD');
export const habitTypeFromApi = (t: HabitType): UiHabitKind => (t === 'GOOD' ? 'build' : 'break');

const TARGET_TO_API: Record<UiTargetType, TargetType> = {
  yesNo: 'YES_NO',
  count: 'COUNT',
  duration: 'DURATION',
};
const TARGET_FROM_API: Record<TargetType, UiTargetType> = {
  YES_NO: 'yesNo',
  COUNT: 'count',
  DURATION: 'duration',
};

const TOD_TO_API: Record<UiTimeOfDay, TimeOfDay> = {
  Morning: 'MORNING',
  Afternoon: 'AFTERNOON',
  Evening: 'EVENING',
  Anytime: 'ANYTIME',
};
const TOD_FROM_API: Record<TimeOfDay, UiTimeOfDay> = {
  MORNING: 'Morning',
  AFTERNOON: 'Afternoon',
  EVENING: 'Evening',
  ANYTIME: 'Anytime',
};
export const timeOfDayFromApi = (t: TimeOfDay): UiTimeOfDay => TOD_FROM_API[t] ?? 'Anytime';

const MOOD_TO_API: Record<UiMood, ApiMood> = {
  Great: 'GREAT',
  Good: 'GOOD',
  Okay: 'NEUTRAL',
  Bad: 'LOW',
  Awful: 'BAD',
};
const MOOD_FROM_API: Record<string, UiMood> = {
  GREAT: 'Great',
  GOOD: 'Good',
  NEUTRAL: 'Okay',
  LOW: 'Bad',
  BAD: 'Awful',
};
export const moodToApi = (m: UiMood): ApiMood => MOOD_TO_API[m];
export const moodFromApi = (m: string | null | undefined): UiMood | undefined =>
  m ? MOOD_FROM_API[m.toUpperCase()] : undefined;

const STATUS_FROM_API: Record<OccurrenceStatus, UiStatus> = {
  PENDING: 'pending',
  COMPLETED: 'done',
  SKIPPED: 'skipped',
  MISSED: 'missed',
};
export const statusFromApi = (s: OccurrenceStatus): UiStatus => STATUS_FROM_API[s];

// ---------- time ----------

export function timeToApi(hhmm: string): string {
  return /^\d{2}:\d{2}$/.test(hhmm) ? `${hhmm}:00` : hhmm;
}
export function timeFromApi(t: string | null | undefined, fallback = '08:00'): string {
  return t ? t.slice(0, 5) : fallback;
}

// ---------- habit <-> draft ----------

export function draftToHabitWrite(draft: HabitDraft, startDate: string): HabitWrite {
  const targetType = TARGET_TO_API[draft.targetType];
  const targetValue =
    draft.targetType === 'count' ? Math.max(1, draft.targetCount) : draft.targetType === 'duration' ? Math.max(1, draft.targetDuration) : 1;
  const targetUnit = draft.targetType === 'count' ? 'times' : draft.targetType === 'duration' ? 'min' : '';

  let frequency_type: 'DAILY' | 'WEEKDAYS' = 'DAILY';
  let weekdays: number[] = [];
  if (draft.frequency === 'weekdays') {
    frequency_type = 'WEEKDAYS';
    weekdays = MON_TO_FRI;
  } else if (draft.frequency === 'custom') {
    frequency_type = 'WEEKDAYS';
    weekdays = uiDaysToApi(draft.customDays);
  }

  return {
    name: draft.name.trim(),
    habit_type: habitTypeToApi(draft.habitType),
    icon: draft.emoji,
    color: colorKeyToHex(draft.colorKey),
    target_type: targetType,
    target_value: targetValue,
    target_unit: targetUnit,
    time_of_day: TOD_TO_API[draft.timeOfDay],
    start_date: startDate,
    schedule: {
      frequency_type,
      weekdays,
      reminder_time: draft.reminderEnabled && draft.reminderTime ? timeToApi(draft.reminderTime) : null,
      skip_allowed: true,
    },
  };
}

export function habitToDraft(habit: Habit): HabitDraft {
  const s = habit.schedule;
  let frequency: UiFrequency = 'daily';
  let customDays: number[] = [];
  if (s?.frequency_type === 'WEEKDAYS') {
    const sorted = [...s.weekdays].sort((a, b) => a - b);
    if (sorted.length === 5 && sorted.every((d, i) => d === MON_TO_FRI[i])) {
      frequency = 'weekdays';
    } else {
      frequency = 'custom';
      customDays = apiDaysToUi(s.weekdays);
    }
  } else if (s?.frequency_type === 'TIMES_PER_WEEK') {
    // The app never creates these; if one exists, make the user pick explicit days on edit.
    frequency = 'custom';
  }

  return {
    name: habit.name,
    emoji: habit.icon,
    colorKey: hexToColorKey(habit.color),
    habitType: habitTypeFromApi(habit.habit_type),
    targetType: TARGET_FROM_API[habit.target_type],
    targetCount: habit.target_type === 'COUNT' ? habit.target_value : 1,
    targetDuration: habit.target_type === 'DURATION' ? habit.target_value : 10,
    frequency,
    customDays,
    reminderEnabled: !!s?.reminder_time,
    reminderTime: timeFromApi(s?.reminder_time),
    timeOfDay: timeOfDayFromApi(habit.time_of_day),
  };
}

// ---------- check-in semantics (BAD habits are inverted) ----------

/** What the person means. For a good habit: success = "I did it". For a bad one: success = "I resisted". */
export type CheckInIntent = 'success' | 'slip' | 'skip';
export type ApiAction = 'complete' | 'skip';

/**
 * Which endpoint to call for a given intent.
 *   GOOD: success -> complete, skip -> skip (needs a reason)
 *   BAD : success (avoided it) -> skip, slip (did it) -> complete
 * Returns null for combinations that make no sense (e.g. "slip" on a good habit).
 */
export function apiActionFor(habitType: HabitType, intent: CheckInIntent): ApiAction | null {
  if (habitType === 'GOOD') {
    if (intent === 'success') return 'complete';
    if (intent === 'skip') return 'skip';
    return null;
  }
  if (intent === 'success') return 'skip';
  if (intent === 'slip') return 'complete';
  return null; // a BAD habit has no separate "skip"
}

/** The backend rejects a skip of a GOOD habit without a reason; BAD "avoided" needs none. */
export function requiresSkipReason(habitType: HabitType, action: ApiAction): boolean {
  return habitType === 'GOOD' && action === 'skip';
}

/** Does this occurrence status count as a win, taking BAD-habit inversion into account? */
export function isSuccess(habitType: HabitType, status: OccurrenceStatus): boolean {
  return habitType === 'GOOD' ? status === 'COMPLETED' : status === 'SKIPPED';
}

/** Short status text for a habit tile, aware that BAD habits are inverted. */
export function statusText(habitType: HabitType, status: OccurrenceStatus): string {
  if (habitType === 'BAD') {
    return { PENDING: 'Check in', SKIPPED: 'Avoided', COMPLETED: 'Slipped', MISSED: 'Missed' }[status];
  }
  return { PENDING: 'To do', COMPLETED: 'Done', SKIPPED: 'Skipped', MISSED: 'Missed' }[status];
}
