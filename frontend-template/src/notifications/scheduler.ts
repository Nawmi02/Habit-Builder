import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from '../api';
import { planReminders, type PlanInput, type ReminderTone } from '../lib/reminders';

const CHANNEL_ID = 'habits';
const PUSH_TOKEN_KEY = 'hb.pushToken';

const toneSound = (tone: ReminderTone): string | true => tone === 'DEFAULT' ? true : `${tone.toLowerCase()}.wav`;
const toneChannel = (tone: ReminderTone) => `${CHANNEL_ID}-${tone.toLowerCase()}`;

type NotificationsModule = typeof import('expo-notifications');

let notificationsPromise: Promise<NotificationsModule | null> | null = null;
let categoriesPromise: Promise<void> | null = null;

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
  const [permissions, handler, emitter, scheduler, cancel, cancelOne, getScheduled, channel, category, notificationTypes, channelTypes] = await Promise.all([
    import('expo-notifications/build/NotificationPermissions'),
    import('expo-notifications/build/NotificationsHandler'),
    import('expo-notifications/build/NotificationsEmitter'),
    import('expo-notifications/build/scheduleNotificationAsync'),
    import('expo-notifications/build/cancelAllScheduledNotificationsAsync'),
    import('expo-notifications/build/cancelScheduledNotificationAsync'),
    import('expo-notifications/build/getAllScheduledNotificationsAsync'),
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
    ...cancelOne,
    ...getScheduled,
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
        void ensureNotificationCategories(Notifications);
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

function ensureNotificationCategories(Notifications: NotificationsModule): Promise<void> {
  if (!categoriesPromise) {
    categoriesPromise = Promise.all([
      Notifications.setNotificationCategoryAsync('HABIT_START', [
        { identifier: 'START_YES', buttonTitle: 'Yes, start' },
        { identifier: 'START_NO', buttonTitle: 'Not yet' },
      ]),
      Notifications.setNotificationCategoryAsync('HABIT_COUNT_START', [
        { identifier: 'START_YES', buttonTitle: 'Yes, start' },
        { identifier: 'START_NO', buttonTitle: 'No' },
        { identifier: 'START_SKIP', buttonTitle: 'Skip today' },
      ]),
      Notifications.setNotificationCategoryAsync('HABIT_BAD_COUNT_START', [
        { identifier: 'START_YES', buttonTitle: 'Yes' },
        { identifier: 'START_NO', buttonTitle: 'No' },
        { identifier: 'START_SKIP', buttonTitle: 'Skip today' },
      ]),
      Notifications.setNotificationCategoryAsync('HABIT_FINISH', [
        { identifier: 'FINISH_YES', buttonTitle: 'Yes, done' },
        { identifier: 'FINISH_NO', buttonTitle: 'No' },
      ]),
      Notifications.setNotificationCategoryAsync('HABIT_BAD_FINISH', [
        { identifier: 'FINISH_YES', buttonTitle: 'Yes' },
        { identifier: 'FINISH_NO', buttonTitle: 'No' },
      ]),
      Notifications.setNotificationCategoryAsync('HABIT_COUNT', [
        { identifier: 'COUNT_YES', buttonTitle: 'Done' },
        { identifier: 'COUNT_NO', buttonTitle: 'Not yet' },
      ]),
      Notifications.setNotificationCategoryAsync('HABIT_BAD_COUNT', [
        { identifier: 'COUNT_YES', buttonTitle: 'I resisted' },
        { identifier: 'COUNT_NO', buttonTitle: 'Not yet' },
      ]),
    ]).then(() => undefined).catch((error) => {
      categoriesPromise = null;
      throw error;
    });
  }
  return categoriesPromise;
}

async function handleHabitAction(Notifications: NotificationsModule, response: import('expo-notifications').NotificationResponse) {
  const { actionIdentifier } = response;
  const data = response.notification.request.content.data as Record<string, unknown>;
  const occurrenceId = Number(data.occurrenceId);
  const habitId = Number(data.habitId);
  if (!occurrenceId || !habitId) return;

  if (
    (actionIdentifier === 'COUNT_NO' && data.phase === 'count') ||
    (actionIdentifier === 'START_NO' && data.phase === 'start')
  ) {
    if (data.phase === 'start' && data.targetType === 'COUNT') {
      await api.occurrences.countAction(occurrenceId, { count_index: Number(data.countIndex), action: 'NOT_YET' });
      await syncAfterReminderAction();
      return;
    }
    await snoozeReminder(Notifications, response.notification.request.content.data as Record<string, unknown>);
    return;
  }

  if (actionIdentifier === 'START_SKIP' && data.phase === 'start' && data.targetType === 'COUNT') {
    await api.occurrences.countAction(occurrenceId, { count_index: Number(data.countIndex), action: 'SKIP' });
    await Notifications.scheduleNotificationAsync({ content: { title: 'Skipped today', body: 'Streak −1 · points −20' }, trigger: null });
    await syncAfterReminderAction();
    return;
  }

  if (actionIdentifier === 'START_YES' && data.phase === 'start' && data.targetType === 'COUNT') {
    const result = await api.occurrences.countAction(occurrenceId, { count_index: Number(data.countIndex), action: 'START' });
    if (data.durationMinutes == null && result.completed) {
      const resisted = String(data.habitType ?? 'GOOD') === 'BAD';
      await Notifications.scheduleNotificationAsync({ content: { title: '🎊🎉🥳', body: resisted ? 'You resisted every count today! Great work.' : 'All counts complete! Target achieved.' }, trigger: null });
    }
    await syncAfterReminderAction();
    return;
  }

  if ((actionIdentifier === 'FINISH_YES' || actionIdentifier === 'FINISH_NO') && data.phase === 'finish' && data.targetType === 'COUNT') {
    const result = await api.occurrences.countAction(occurrenceId, {
      count_index: Number(data.countIndex),
      action: actionIdentifier === 'FINISH_YES' ? 'COMPLETE' : 'FAIL',
    });
    if (actionIdentifier === 'FINISH_YES') {
      const resisted = String(data.habitType ?? 'GOOD') === 'BAD';
      await Notifications.scheduleNotificationAsync({
        content: { title: result.completed ? '🎊🎉🥳' : 'Count complete', body: result.completed ? (resisted ? 'You resisted every count today! Great work.' : 'All counts complete! Target achieved.') : (resisted ? 'Count resisted. Keep going!' : 'Count saved. Keep going!') },
        trigger: null,
      });
    } else {
      await Notifications.scheduleNotificationAsync({ content: { title: '😞💔 Better luck next time', body: 'Points −5. You can try this count again.' }, trigger: null });
    }
    await syncAfterReminderAction();
    return;
  }

  if (actionIdentifier === 'COUNT_YES' && data.phase === 'count') {
    const result = await api.occurrences.progress(occurrenceId, {
      increment: 1,
      slot_index: Number(data.countIndex),
      source: 'REMINDER',
      mood: 'GOOD',
    });
    if (result.completed) {
      await Notifications.scheduleNotificationAsync({
        content: { title: '🎉🎊🥳', body: 'Target achieved! Great work.' },
        trigger: null,
      });
    } else {
      const current = result.occurrence.progress_value;
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Progress saved', body: `${current}/${Number(data.targetValue ?? 1)} counts done.` },
        trigger: null,
      });
    }
    await syncAfterReminderAction();
    return;
  }

  if (actionIdentifier === 'START_YES' && data.phase === 'start') {
    const started = await api.occurrences.start(occurrenceId);
    // Re-plan using the server's start time. If the normal sync cannot produce
    // a plan, still leave one finish prompt on-device for this duration target.
    const syncResult = await syncAfterReminderAction();
    if (
      (!syncResult || (syncResult.enabled && syncResult.scheduled === 0)) &&
      data.targetType === 'DURATION' &&
      started.started_at
    ) {
      await scheduleDurationFinishReminder({
        occurrenceId,
        habitId,
        name: String(data.name ?? 'Habit'),
        habitType: String(data.habitType ?? 'GOOD'),
        targetValue: Number(data.targetValue ?? 0),
        startedAt: started.started_at,
        reminderTone: (data.reminderTone as ReminderTone) ?? 'DEFAULT',
      });
    }
    return;
  }

  if (actionIdentifier === 'FINISH_YES' && data.phase === 'finish') {
    const resisted = String(data.habitType ?? 'GOOD') === 'BAD';
    if (resisted) await api.occurrences.skip(occurrenceId, {});
    else await api.occurrences.complete(occurrenceId, { progress_value: Number(data.targetValue ?? 1), mood: 'GOOD' });
    await Notifications.scheduleNotificationAsync({
      content: { title: '🎉🎊🥳', body: resisted ? 'Great job resisting today!' : 'Target achieved! Great work.' },
      trigger: null,
    });
    await syncAfterReminderAction();
    return;
  }

  if (actionIdentifier === 'FINISH_NO' && data.phase === 'finish') {
    const slipped = String(data.habitType ?? 'GOOD') === 'BAD';
    if (slipped) {
      await api.occurrences.complete(occurrenceId, { progress_value: Number(data.targetValue ?? 1) });
      await syncAfterReminderAction();
    }
    await Notifications.scheduleNotificationAsync({
      content: { title: '😞💔 Better luck next time', body: slipped ? 'Slip recorded. Try again tomorrow.' : 'Your streak did not increase today.' },
      trigger: null,
    });
  }
}

async function snoozeReminder(Notifications: NotificationsModule, data: Record<string, unknown>): Promise<void> {
  const occurrenceId = Number(data.occurrenceId);
  const phase = String(data.phase);
  const countIndex = data.countIndex == null ? '' : String(data.countIndex);
  const identifier = `snooze|${occurrenceId}|${phase}|${countIndex}`;
  const fireAt = new Date(Date.now() + 5 * 60_000);
  const existing = await Notifications.getAllScheduledNotificationsAsync();

  // Replace this action's previous snooze and any planner retry at the same time.
  await Promise.all(existing.filter((request) => {
    if (request.identifier === identifier) return true;
    const requestData = request.content.data as Record<string, unknown> | undefined;
    if (Number(requestData?.occurrenceId) !== occurrenceId || requestData?.phase !== phase) return false;
    if (phase === 'count' && Number(requestData?.countIndex) !== Number(data.countIndex)) return false;
    const triggerDate = (request.trigger as { date?: string | number | Date } | null)?.date;
    return triggerDate != null && Math.abs(new Date(triggerDate).getTime() - fireAt.getTime()) < 60_000;
  }).map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)));

  const tone = (data.reminderTone as ReminderTone) ?? 'DEFAULT';
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title: phase === 'count' ? String(data.name ?? 'Habit reminder') : `${String(data.name ?? 'Habit')} reminder`,
      body: phase === 'count'
        ? String(data.habitType ?? 'GOOD') === 'BAD' ? 'Resisted?' : 'Ready to complete this count?'
        : String(data.habitType ?? 'GOOD') === 'BAD' ? 'Start your resistance session now?' : 'Ready to start your habit now?',
      data,
      categoryIdentifier: phase === 'count'
        ? String(data.habitType ?? 'GOOD') === 'BAD' ? 'HABIT_BAD_COUNT' : 'HABIT_COUNT'
        : data.targetType === 'COUNT'
          ? String(data.habitType ?? 'GOOD') === 'BAD' ? 'HABIT_BAD_COUNT_START' : 'HABIT_COUNT_START'
          : 'HABIT_START',
      sound: Constants.executionEnvironment === 'storeClient' ? true : toneSound(tone),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      ...(Constants.executionEnvironment === 'storeClient' ? {} : { channelId: toneChannel(tone) }),
    },
  });
}

async function syncAfterReminderAction(): Promise<{ enabled: boolean; scheduled: number } | null> {
  try {
    const user = await api.users.me();
    const { syncReminders } = await import('./syncReminders');
    return { enabled: user.notifications_enabled, scheduled: await syncReminders(user) };
  } catch {
    // The action itself is recorded before the optional reminder refresh.
    return null;
  }
}

/** Schedule a one-off duration finish prompt if syncing the full plan failed. */
export async function scheduleDurationFinishReminder(input: {
  occurrenceId: number;
  habitId: number;
  name: string;
  habitType: string;
  targetValue: number;
  startedAt: string;
  reminderTone?: ReminderTone;
}): Promise<boolean> {
  const Notifications = await getNotifications();
  const tone = input.reminderTone ?? 'DEFAULT';
  if (!Notifications || !(await ensurePermission([tone]))) return false;

  const existing = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    existing
      .filter((request) => Number(request.content.data?.occurrenceId) === input.occurrenceId)
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );

  const durationEnd = new Date(new Date(input.startedAt).getTime() + input.targetValue * 60_000);
  const fireAt = new Date(Math.max(Date.now() + 5000, durationEnd.getTime()));
  await Notifications.scheduleNotificationAsync({
    identifier: `duration-finish|${input.occurrenceId}|${fireAt.getTime()}`,
    content: {
      title: 'Target achieved today?',
      body: `${input.name} — did you reach your target?`,
      data: {
        occurrenceId: input.occurrenceId,
        habitId: input.habitId,
        name: input.name,
        habitType: input.habitType,
        targetType: 'DURATION',
        targetValue: input.targetValue,
        phase: 'finish',
        reminderTone: tone,
      },
      categoryIdentifier: input.habitType === 'BAD' ? 'HABIT_BAD_FINISH' : 'HABIT_FINISH',
      sound: Constants.executionEnvironment === 'storeClient' ? true : toneSound(tone),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      ...(Constants.executionEnvironment === 'storeClient' ? {} : { channelId: toneChannel(tone) }),
    },
  });
  return true;
}

/** Request permission before scheduling local reminders. */
export async function ensurePermission(tones: ReminderTone[] = ['DEFAULT']): Promise<boolean> {
  const Notifications = await getNotifications();

  if (!Notifications) {
    return false;
  }

  // Expo Go's Android host can lack the channel provider even though local
  // notifications are available. In that case use its fallback channel.
  const canCreateChannels = Constants.executionEnvironment !== 'storeClient';
  if (Platform.OS === 'android' && canCreateChannels) {
    for (const tone of [...new Set(tones)]) {
      await Notifications.setNotificationChannelAsync(toneChannel(tone), {
        name: `Habit reminders · ${tone.toLowerCase()}`,
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#7C3AED',
        sound: tone === 'DEFAULT' ? 'default' : toneSound(tone) as string,
      });
    }
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

  const plan = planReminders(input);

  await ensureNotificationCategories(Notifications);

  if (plan.length === 0) {
    await Notifications.cancelAllScheduledNotificationsAsync();
    return 0;
  }

  const tones = [...new Set(plan.map((reminder) => reminder.data.reminderTone ?? 'DEFAULT'))];
  if (!(await ensurePermission(tones))) {
    console.warn('Habit reminders were not scheduled: notification permission is not granted. Enable notifications for Habit Builder in Android settings.');
    return 0;
  }

  // Keep existing reminders if permission is temporarily unavailable. Replace
  // the old plan only once the new plan is ready to schedule. Preserve a user's
  // active "Not yet" snooze while removing stale planner retries.
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const pendingSnoozes = new Set(plan.map((reminder) => {
    if (!reminder.data.occurrenceId || !reminder.data.phase) return '';
    const slot = reminder.data.phase === 'count' ? String(reminder.data.countIndex ?? '') : '';
    return `snooze|${reminder.data.occurrenceId}|${reminder.data.phase}|${slot}`;
  }));
  await Promise.all(scheduled
    .filter((request) => !request.identifier.startsWith('snooze|') || !pendingSnoozes.has(request.identifier))
    .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)));

  for (const reminder of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.key,
      content: {
        title: reminder.title,
        body: reminder.body,
        data: reminder.data,
        categoryIdentifier: reminder.data.phase === 'expired'
          ? undefined
          : reminder.data.phase === 'count'
          ? reminder.data.habitType === 'BAD' ? 'HABIT_BAD_COUNT' : 'HABIT_COUNT'
          : reminder.data.phase === 'finish'
            ? (reminder.data.habitType === 'BAD' ? 'HABIT_BAD_FINISH' : 'HABIT_FINISH')
            : reminder.data.targetType === 'COUNT'
              ? reminder.data.habitType === 'BAD' ? 'HABIT_BAD_COUNT_START' : 'HABIT_COUNT_START'
              : 'HABIT_START',
        sound: Constants.executionEnvironment === 'storeClient'
          ? true
          : toneSound(reminder.data.reminderTone ?? 'DEFAULT'),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminder.fireAt,
        ...(Constants.executionEnvironment === 'storeClient' ? {} : { channelId: toneChannel(reminder.data.reminderTone ?? 'DEFAULT') }),
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
      ...(Constants.executionEnvironment === 'storeClient' ? {} : { channelId: toneChannel('DEFAULT') }),
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
