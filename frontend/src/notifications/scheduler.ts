/**
 * React Native glue for local notifications (expo-notifications).
 * All the DECISIONS live in src/lib/reminders.ts (pure + tested); this file only talks to the OS.
 *
 * Checked against the SDK 57 expo-notifications docs: DATE / TIME_INTERVAL triggers, handler
 * flags (shouldShowBanner / shouldShowList), Android channels. Local notifications work in
 * Expo Go; REMOTE push does NOT work in Expo Go on Android - use a development build for that.
 * NOT yet run on a real device - verify with the "Send me a test reminder" button in Settings.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../api';
import { planReminders, type PlanInput } from '../lib/reminders';

const CHANNEL_ID = 'habits';
const PUSH_TOKEN_KEY = 'hb.pushToken';

/** Call once at app start (module scope of the root layout). */
export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/** Asks for permission if needed. Returns whether we may schedule. */
export async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    // On Android 13+ the channel must exist BEFORE the permission prompt appears.
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Habit reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7C3AED',
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.status === 'granted';
}

export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Replace every scheduled reminder with the freshly planned set.
 * Returns how many were scheduled (0 if permission was denied).
 */
export async function applyPlan(input: PlanInput): Promise<number> {
  await cancelAllReminders();
  const plan = planReminders(input);
  if (plan.length === 0) return 0;
  if (!(await ensurePermission())) return 0;
  for (const n of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: n.key,
      content: { title: n.title, body: n.body, data: n.data, sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: n.fireAt, channelId: CHANNEL_ID },
    });
  }
  return plan.length;
}

/** "Send me a test reminder": fires in 5 seconds so the team can see/hear exactly what users get. */
export async function scheduleTestReminder(): Promise<boolean> {
  if (!(await ensurePermission())) return false;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "🔥 Don't let today slip away",
      body: "Meditate and 2 more are still waiting - don't break the chain.",
      sound: true,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, channelId: CHANNEL_ID },
  });
  return true;
}

/**
 * Register this phone for SERVER push (POST /devices/).
 * DECISION NEEDED with the backend team: this sends an *Expo* push token, which must be sent
 * through Expo's push service. If the backend will talk to FCM/APNs directly, swap to
 * Notifications.getDevicePushTokenAsync(). The backend's sender is not configured yet anyway.
 * Never throws - push is a bonus; local reminders don't depend on it.
 */
export async function registerPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    if (!(await ensurePermission())) return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return; // no EAS project yet -> no Expo push token available
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.devices.register(token, Platform.OS === 'ios' ? 'IOS' : 'ANDROID');
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

/** Called on sign-out so this phone stops receiving the previous user's pushes. */
export async function unregisterPushToken(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (token) await api.devices.unregister(token);
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
