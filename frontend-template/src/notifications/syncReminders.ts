/**
 * Gathers current state from the API and re-plans every local reminder.
 * Call it whenever something that affects reminders changes: app opens / returns to the
 * foreground, a habit is completed or skipped, a habit is created/edited/paused, or
 * reminder settings change.  (Cost: 1 habits call + 3 checklist calls + up to ~N streak calls.)
 */
import { api } from '../api';
import { timeFromApi } from '../api/mappers';
import type { Checklist, User } from '../api/types';
import { Platform } from 'react-native';
import { flattenChecklist } from '../lib/checklist';
import { addDays, toDateString } from '../lib/dates';
import type { PlanDay } from '../lib/reminders';
import { loadReminderPrefs } from './prefs';
import { applyPlan, cancelAllReminders } from './scheduler';

const HORIZON_DAYS = 3;

export async function syncReminders(user: Pick<User, 'notifications_enabled'>): Promise<number> {
  // Web browsers cannot reliably schedule notifications while the app is closed.
  if (Platform.OS === 'web') return 0;

  if (!user.notifications_enabled) {
    await cancelAllReminders();
    return 0;
  }
  const prefs = await loadReminderPrefs();
  const today = toDateString(new Date());
  const dates = Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(today, i));

  const [habits, ...checklists] = await Promise.all([
    api.habits.list('ACTIVE'),
    ...dates.map((d) => api.habits.checklist(d).catch((): Checklist | null => null)),
  ]);

  const reminderTime = new Map<number, string | null>(
    habits.map((h) => [h.habit_id, h.schedule?.reminder_time ? timeFromApi(h.schedule.reminder_time) : null]),
  );

  // Streaks only matter for the "streak at risk" alert, and only for habits still pending today.
  const streaks = new Map<number, number>();
  if (prefs.streakAlert) {
    const todayItems = flattenChecklist(checklists[0] ?? undefined).filter((i) => i.status === 'PENDING');
    await Promise.all(
      todayItems.map(async (i) => {
        try {
          streaks.set(i.habit_id, (await api.habits.streak(i.habit_id)).current_streak);
        } catch {
          /* unknown streak -> no claim */
        }
      }),
    );
  }

  const days: PlanDay[] = checklists.map((c, idx) => ({
    date: c?.date ?? dates[idx],
    items: flattenChecklist(c ?? undefined).map((i) => ({
      occurrenceId: i.occurrence_id,
      habitId: i.habit_id,
      name: i.name,
      emoji: i.icon,
      habitType: i.habit_type,
      targetType: i.target_type,
      targetValue: i.target_value,
      startedAt: i.started_at,
      status: i.status,
      reminderTime: prefs.mutedHabitIds.includes(i.habit_id) ? null : (reminderTime.get(i.habit_id) ?? null),
      currentStreak: streaks.get(i.habit_id),
    })),
  }));

  return applyPlan({
    now: new Date(),
    intensity: prefs.intensity,
    masterEnabled: true,
    streakAlertEnabled: prefs.streakAlert,
    days,
  });
}
