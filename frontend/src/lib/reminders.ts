/**
 * Reminder planner - decides WHICH local notifications should exist right now.
 *
 * Pure function: (current state) -> list of notifications. The React Native side
 * (src/notifications/scheduler.ts) just cancels everything and schedules this list, and
 * re-runs it whenever something changes (check-in, habit edit, settings change, app opens).
 * Re-planning on every change is what makes it "intense but not wrong": the moment you
 * finish your last habit, today's remaining nags disappear.
 *
 * WHY LOCAL notifications (not server push) for the escalation:
 *  - they fire even offline / app closed, with no server involved;
 *  - the backend's reminder sender is not configured (HABIT_REMINDER_SENDER) and the backend
 *    only ever creates ONE reminder per occurrence (escalation_level 1).
 *
 * DESIGN (to fit the OS limit of 64 pending local notifications on iOS):
 *  - one "habit" reminder per pending habit at ITS reminder time (named, level 1)
 *  - ONE shared escalation ladder per day, not per habit (that's the Duolingo feel without
 *    6 habits x 9 nags = 54 notifications a day)
 *  - plan up to 3 days ahead, nearest first, hard cap of 60
 *
 * Times are the PHONE'S local clock (that is what the user sees and what the OS fires on).
 * Product decisions that are easy to change are the constants below.
 */

import type { HabitType, OccurrenceStatus } from '../api/types';

export type ReminderIntensity = 'gentle' | 'motivated' | 'intense';

export interface PlanItem {
  occurrenceId: number;
  habitId: number;
  name: string;
  emoji: string;
  habitType: HabitType;
  status: OccurrenceStatus;
  /** "HH:MM", or null when this habit has reminders turned off. */
  reminderTime: string | null;
  /** Only if known (needs GET /habits/{id}/streak/). Unknown -> no streak-alert claim. */
  currentStreak?: number;
}

export interface PlanDay {
  date: string; // YYYY-MM-DD (the occurrence's scheduled_date)
  items: PlanItem[];
}

export interface PlanInput {
  now: Date;
  intensity: ReminderIntensity;
  masterEnabled: boolean;
  streakAlertEnabled: boolean;
  days: PlanDay[];
  maxScheduled?: number;
}

export interface PlannedNotification {
  /** Stable id: same situation -> same key. Used as the notification identifier. */
  key: string;
  fireAt: Date;
  kind: 'habit' | 'ladder' | 'streak';
  level: 1 | 2 | 3 | 4;
  title: string;
  body: string;
  data: { date: string; occurrenceId?: number };
}

// ---- tunable product constants (minutes after midnight, phone-local) ----
export const DEFAULT_ANCHOR = 9 * 60; // ladder starts here if no habit has a reminder time
export const MOTIVATED_MID_AFTER = 4 * 60; // motivated: one extra nudge 4h after the anchor
export const EVENING_NUDGE = 20 * 60; // 20:00 - evening nudge / streak-at-risk alert
export const INTENSE_STEP = 2 * 60; // intense: every 2h after the anchor...
export const INTENSE_LAST_REGULAR = 21 * 60; // ...until 21:00
export const FINAL_CALL = 23 * 60; // 23:00 - "last hour" (intense only)
export const MIN_GAP_MINUTES = 20; // never two notifications closer than this
export const DEFAULT_MAX_SCHEDULED = 60; // iOS hard limit is 64

const PRIORITY = { ladder: 1, habit: 2, streak: 3 } as const;

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function at(date: string, minutes: number): Date {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60, 0, 0);
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}`;

function ladderMinutes(intensity: ReminderIntensity, anchor: number): number[] {
  if (intensity === 'gentle') return [];
  if (intensity === 'motivated') {
    const out: number[] = [];
    const mid = anchor + MOTIVATED_MID_AFTER;
    if (mid <= EVENING_NUDGE - 60) out.push(mid); // skip if it would crowd the evening nudge
    out.push(EVENING_NUDGE);
    return out;
  }
  const out: number[] = [];
  for (let t = anchor + INTENSE_STEP; t <= INTENSE_LAST_REGULAR; t += INTENSE_STEP) out.push(t);
  out.push(FINAL_CALL);
  return out;
}

function ladderLevel(minutes: number): 2 | 3 | 4 {
  if (minutes >= FINAL_CALL) return 4;
  const hoursLeft = (24 * 60 - minutes) / 60;
  return hoursLeft > 8 ? 2 : 3;
}

function subject(pending: PlanItem[]): string {
  const first = `${pending[0].emoji} ${pending[0].name}`;
  return pending.length === 1 ? `${first} is` : `${first} and ${pending.length - 1} more are`;
}

const LADDER_TITLES: Record<2 | 3 | 4, string[]> = {
  2: ['Still on your list today', 'Quick check-in?', 'Your habits are waiting'],
  3: ["Don't let today slip away 🔥", 'Your streak needs you 🔥', 'So close - keep going 💪'],
  4: ['Last hour! 🚨', 'Final call 🚨', 'Almost midnight ⏰'],
};

function ladderBody(level: 2 | 3 | 4, pending: PlanItem[]): string {
  const who = subject(pending);
  if (level === 2) return `${who} still waiting. A quick check-in keeps you on track.`;
  if (level === 3) return `${who} still waiting - don't break the chain.`;
  return `${who} still waiting. Finish before midnight!`;
}

export function planReminders(input: PlanInput): PlannedNotification[] {
  if (!input.masterEnabled) return [];
  const cap = input.maxScheduled ?? DEFAULT_MAX_SCHEDULED;
  const earliest = input.now.getTime() + 5000; // never schedule "now"
  const all: (PlannedNotification & { priority: number })[] = [];

  for (const day of input.days) {
    const pending = day.items.filter((i) => i.status === 'PENDING');
    if (pending.length === 0) continue; // nothing left to nag about on that day

    const push = (n: PlannedNotification) => all.push({ ...n, priority: PRIORITY[n.kind] });

    // 1) each pending habit, at its own reminder time
    for (const item of pending) {
      if (!item.reminderTime) continue;
      const m = minutesOf(item.reminderTime);
      push({
        key: `${day.date}|habit|${item.habitId}|${hhmm(m)}`,
        fireAt: at(day.date, m),
        kind: 'habit',
        level: 1,
        title: `${item.emoji} ${item.name}`,
        body:
          item.habitType === 'BAD'
            ? 'Check in: did you stay strong today?'
            : 'Your habit is waiting. Keep the streak going!',
        data: { date: day.date, occurrenceId: item.occurrenceId },
      });
    }

    // 2) the shared escalation ladder
    const times = pending.filter((i) => i.reminderTime).map((i) => minutesOf(i.reminderTime as string));
    const anchor = times.length ? Math.min(...times) : DEFAULT_ANCHOR;
    ladderMinutes(input.intensity, anchor).forEach((m, idx) => {
      const level = ladderLevel(m);
      const titles = LADDER_TITLES[level];
      push({
        key: `${day.date}|ladder|all|${hhmm(m)}`,
        fireAt: at(day.date, m),
        kind: 'ladder',
        level,
        title: titles[idx % titles.length],
        body: ladderBody(level, pending),
        data: { date: day.date },
      });
    });

    // 3) streak-at-risk at 20:00 - only when we actually KNOW a streak of 3+ is on the line
    if (input.streakAlertEnabled) {
      const atRisk = pending.filter((i) => (i.currentStreak ?? 0) >= 3);
      if (atRisk.length) {
        const top = atRisk.reduce((a, b) => ((b.currentStreak ?? 0) > (a.currentStreak ?? 0) ? b : a));
        push({
          key: `${day.date}|streak|${top.habitId}|${hhmm(EVENING_NUDGE)}`,
          fireAt: at(day.date, EVENING_NUDGE),
          kind: 'streak',
          level: 3,
          title: `🚨 ${top.currentStreak}-day streak at risk`,
          body: `Finish ${top.emoji} ${top.name} before midnight to keep it alive.`,
          data: { date: day.date, occurrenceId: top.occurrenceId },
        });
      }
    }
  }

  // drop the past, sort, then enforce a minimum gap (higher priority wins a collision)
  const future = all.filter((n) => n.fireAt.getTime() > earliest).sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  const kept: typeof all = [];
  for (const n of future) {
    const last = kept[kept.length - 1];
    if (last && n.fireAt.getTime() - last.fireAt.getTime() < MIN_GAP_MINUTES * 60000) {
      if (n.priority > last.priority) kept[kept.length - 1] = n;
      continue;
    }
    kept.push(n);
  }

  return kept.slice(0, cap).map(({ priority: _p, ...n }) => n);
}
