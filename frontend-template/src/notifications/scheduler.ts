import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from '../api';
import { planReminders, type PlanInput } from '../lib/reminders';

const CHANNEL_ID = 'habits';
const PUSH_TOKEN_KEY = 'hb.pushToken';

type NotificationsModule = typeof import('expo-notifications');

let notificationsPromise: Promise<NotificationsModule | null> | null = null;

/**
 * Load notifications lazily.
 *
 * Expo Go may not contain the native module expected by this project.
 * That must not prevent the rest of the app from opening.
 */
function getNotifications(): Promise<NotificationsModule | null> {
  // Expo Go may not contain the native module required by this package.
  // Do not import expo-notifications at all in Expo Go.
  if (Constants.executionEnvironment === 'storeClient') {
    return Promise.resolve(null);
  }

  if (!notificationsPromise) {
    notificationsPromise = import('expo-notifications').catch((error) => {
      console.warn(
        'Notifications unavailable:',
        error instanceof Error ? error.message : error,
      );
      return null;
    });
  }

  return notificationsPromise;
}

/** Called at startup. Failure to load notifications must never crash the app. */
export function configureNotifications(): void {
  void getNotifications()
    .then((Notifications) => {
      Notifications?.setNotificationHandler({
        handleNotification: async () => ({
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
    })
    .catch(() => {
      // Notifications are optional during app startup.
    });
}

/** Request permission before scheduling local reminders. */
export async function ensurePermission(): Promise<boolean> {
  const Notifications = await getNotifications();

  if (!Notifications) {
    return false;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Habit reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7C3AED',
    });
  }

  const current = await Notifications.getPermissionsAsync();

  if (current.status === 'granted') {
    return true;
  }

  if (!current.canAskAgain) {
    return false;
  }

  const requested = await Notifications.requestPermissionsAsync();

  return requested.status === 'granted';
}

/** Cancel all scheduled local reminders when supported. */
export async function cancelAllReminders(): Promise<void> {
  const Notifications = await getNotifications();

  if (!Notifications) {
    return;
  }

  await Notifications.cancelAllScheduledNotificationsAsync();
}

/** Replace scheduled reminders with the currently planned reminders. */
export async function applyPlan(input: PlanInput): Promise<number> {
  const Notifications = await getNotifications();

  if (!Notifications) {
    return 0;
  }

  await Notifications.cancelAllScheduledNotificationsAsync();

  const plan = planReminders(input);

  if (plan.length === 0) {
    return 0;
  }

  if (!(await ensurePermission())) {
    return 0;
  }

  for (const reminder of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.key,
      content: {
        title: reminder.title,
        body: reminder.body,
        data: reminder.data,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminder.fireAt,
        channelId: CHANNEL_ID,
      },
    });
  }

  return plan.length;
}

/** Schedule a test notification for five seconds from now. */
export async function scheduleTestReminder(): Promise<boolean> {
  const Notifications = await getNotifications();

  if (!Notifications || !(await ensurePermission())) {
    return false;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "🔥 Don't let today slip away",
      body: 'Your habits are waiting. Keep your streak going!',
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 5,
      channelId: CHANNEL_ID,
    },
  });

  return true;
}

/** Register this device for Expo push notifications when supported. */
export async function registerPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) {
      return;
    }

    const Notifications = await getNotifications();

    if (!Notifications || !(await ensurePermission())) {
      return;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    if (!projectId) {
      return;
    }

    const { data: token } =
      await Notifications.getExpoPushTokenAsync({ projectId });

    await api.devices.register(
      token,
      Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
    );

    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
  } catch (error) {
    console.warn('Could not register push token:', error);
  }
}

/** Remove this device's previously stored push token at sign-out. */
export async function unregisterPushToken(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);

    if (token) {
      await api.devices.unregister(token);
    }

    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {
    // Sign-out should not fail because push registration could not be removed.
  }
}