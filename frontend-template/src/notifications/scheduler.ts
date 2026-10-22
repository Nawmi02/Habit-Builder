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
  // expo-notifications is native only; importing it during web/SSR can access
  // browser globals before they exist and produce a server render error.
  if (Platform.OS === 'web') {
    return Promise.resolve(null);
  }

  if (!notificationsPromise) {
    notificationsPromise = loadNotificationApis().catch((error) => {
      console.warn(
        'Notifications unavailable:',
        error instanceof Error ? error.message : error,
      );
      return null;
    });
  }

  return notificationsPromise;
}

/**
 * Load only local-notification APIs. Importing expo-notifications' barrel also
 * eagerly loads its Android push-topic module, which Expo Go does not include.
 */
async function loadNotificationApis(): Promise<NotificationsModule> {
  const [permissions, handler, emitter, scheduler, cancel, channel, category, notificationTypes, channelTypes] = await Promise.all([
    import('expo-notifications/build/NotificationPermissions'),
    import('expo-notifications/build/NotificationsHandler'),
    import('expo-notifications/build/NotificationsEmitter'),
    import('expo-notifications/build/scheduleNotificationAsync'),
    import('expo-notifications/build/cancelAllScheduledNotificationsAsync'),
    import('expo-notifications/build/setNotificationChannelAsync'),
    import('expo-notifications/build/setNotificationCategoryAsync'),
    import('expo-notifications/build/Notifications.types'),
    import('expo-notifications/build/NotificationChannelManager.types'),
  ]);

  const push = Constants.executionEnvironment === 'storeClient'
    ? {}
    : await import('expo-notifications/build/getExpoPushTokenAsync');

  return {
    ...permissions,
    ...handler,
    ...emitter,
    ...scheduler,
    ...cancel,
    ...channel,
    ...category,
    ...push,
    AndroidImportance: channelTypes.AndroidImportance,
    SchedulableTriggerInputTypes: notificationTypes.SchedulableTriggerInputTypes,
  } as unknown as NotificationsModule;
}

/** Called at startup. Failure to load notifications must never crash the app. */
export function configureNotifications(): void {
  if (Platform.OS === 'web') {
    return;
  }

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
      if (Notifications) {
        void Notifications.setNotificationCategoryAsync('HABIT_START', [
          { identifier: 'START_YES', buttonTitle: 'Yes, start' },
          { identifier: 'START_NO', buttonTitle: 'No' },
        ]);
        void Notifications.setNotificationCategoryAsync('HABIT_FINISH', [
          { identifier: 'FINISH_YES', buttonTitle: 'Yes, done' },
          { identifier: 'FINISH_NO', buttonTitle: 'No' },
        ]);
        void Notifications.addNotificationResponseReceivedListener((response) => {
          void handleHabitAction(Notifications, response).catch((error) =>
            console.warn('Could not process habit reminder action:', error),
          );
        });
      }
    })
    .catch(() => {
      // Notifications are optional during app startup.
    });
}

async function handleHabitAction(Notifications: NotificationsModule, response: import('expo-notifications').NotificationResponse) {
  const { actionIdentifier } = response;
  const data = response.notification.request.content.data as Record<string, unknown>;
  const occurrenceId = Number(data.occurrenceId);
  const habitId = Number(data.habitId);
  if (!occurrenceId || !habitId) return;

  if (actionIdentifier === 'START_YES' && data.phase === 'start') {
    await api.occurrences.start(occurrenceId);
    // Re-plan with the saved start time; this schedules the target prompt and retries.
    await syncAfterReminderAction();
    return;
  }

  if (actionIdentifier === 'FINISH_YES' && data.phase === 'finish') {
    if (String(data.habitType ?? 'GOOD') === 'BAD') await api.occurrences.skip(occurrenceId, {});
    else await api.occurrences.complete(occurrenceId, { progress_value: Number(data.targetValue ?? 1), mood: 'GOOD' });
    await Notifications.scheduleNotificationAsync({
      content: { title: '🎉🎊🥳', body: 'Target achieved! Great work.' },
      trigger: null,
    });
    await syncAfterReminderAction();
    return;
  }

  if (actionIdentifier === 'FINISH_NO' && data.phase === 'finish') {
    await Notifications.scheduleNotificationAsync({
      content: { title: '😞💔 Better luck next time', body: 'Your streak did not increase today.' },
      trigger: null,
    });
  }
}

async function syncAfterReminderAction() {
  try {
    const user = await api.users.me();
    const { syncReminders } = await import('./syncReminders');
    await syncReminders(user);
  } catch {
    // The action itself is recorded before the optional reminder refresh.
  }
}

/** Request permission before scheduling local reminders. */
export async function ensurePermission(): Promise<boolean> {
  const Notifications = await getNotifications();

  if (!Notifications) {
    return false;
  }

  // Expo Go's Android host can lack the channel provider even though local
  // notifications are available. In that case use its fallback channel.
  const canCreateChannels = Constants.executionEnvironment !== 'storeClient';
  if (Platform.OS === 'android' && canCreateChannels) {
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
    console.warn('Habit reminders were not scheduled: notification permission is not granted. Enable notifications for Habit Builder in Android settings.');
    return 0;
  }

  for (const reminder of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.key,
      content: {
        title: reminder.title,
        body: reminder.body,
        data: reminder.data,
        categoryIdentifier: reminder.data.phase === 'finish' ? 'HABIT_FINISH' : 'HABIT_START',
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminder.fireAt,
        ...(Constants.executionEnvironment === 'storeClient' ? {} : { channelId: CHANNEL_ID }),
      },
    });
  }

  console.info(`Scheduled ${plan.length} local habit reminder(s).`);

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
      ...(Constants.executionEnvironment === 'storeClient' ? {} : { channelId: CHANNEL_ID }),
    },
  });

  return true;
}

/** Register this device for Expo push notifications when supported. */
export async function registerPushToken(): Promise<void> {
  try {
    // Expo Go on Android supports local notifications but not remote push tokens.
    if (Platform.OS === 'web' || Constants.executionEnvironment === 'storeClient') {
      return;
    }

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

  } catch {
    // Sign-out should not fail because push registration could not be removed.
  } finally {
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY).catch(() => {});
  }
}
