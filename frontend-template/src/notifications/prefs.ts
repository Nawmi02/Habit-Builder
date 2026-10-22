import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReminderIntensity } from '../lib/reminders';

/**
 * Reminder preferences live on the phone: the backend only stores a single
 * `notifications_enabled` boolean and each habit's reminder_time.
 * (Ask the backend team for server-side prefs if you want them to follow the user.)
 */
export interface ReminderPrefs {
  intensity: ReminderIntensity;
  streakAlert: boolean;
  /** habit ids whose reminders the user switched off but whose time we keep. */
  mutedHabitIds: number[];
}

export const DEFAULT_PREFS: ReminderPrefs = { intensity: 'intense', streakAlert: true, mutedHabitIds: [] };
const KEY = 'hb.reminderPrefs';

export async function loadReminderPrefs(): Promise<ReminderPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<ReminderPrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function saveReminderPrefs(prefs: ReminderPrefs): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(prefs));
}
