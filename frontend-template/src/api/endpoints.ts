/**
 * One typed function per backend endpoint. Screens/hooks call these; they never build URLs.
 * Paths are relative to the API base (".../api") and ALL end with a trailing slash
 * (Django APPEND_SLASH would otherwise redirect and drop the POST body).
 */

import type { HttpClient } from './http';
import type {
  AuthTokens,
  Badge,
  Checklist,
  CompletionInput,
  DevicePlatform,
  DeviceToken,
  Habit,
  HabitStatus,
  HabitWrite,
  LoginRequest,
  Occurrence,
  OccurrenceActionResponse,
  Paginated,
  PointsSummary,
  PointTransaction,
  RegisterRequest,
  RegisterResponse,
  SkipInput,
  SkipReason,
  Streak,
  User,
  UserBadge,
  UserReward,
  UserUpdate,
  ID,
} from './types';

export function createApi(http: HttpClient) {
  /** Follows DRF `next` links until exhausted (hard cap protects against runaway loops). */
  async function listAll<T>(firstPath: string, query?: Record<string, string | number | undefined>): Promise<T[]> {
    const out: T[] = [];
    let page = await http.get<Paginated<T>>(firstPath, { query });
    out.push(...page.results);
    let guard = 0;
    while (page.next && guard++ < 20) {
      page = await http.get<Paginated<T>>(page.next); // absolute URL, passed through as-is
      out.push(...page.results);
    }
    return out;
  }

  return {
    auth: {
      register: (body: RegisterRequest) => http.post<RegisterResponse>('/auth/register/', body, { auth: false }),
      /** Login returns only tokens; call users.me() afterwards. */
      login: (body: LoginRequest) => http.post<AuthTokens>('/auth/login/', body, { auth: false }),
    },

    users: {
      me: () => http.get<User>('/users/me/'),
      update: (patch: UserUpdate) => http.patch<User>('/users/me/', patch),
    },

    devices: {
      /** POST /devices/ (the viewset's create). Not /devices/register/. */
      register: (push_token: string, platform: DevicePlatform) =>
        http.post<DeviceToken>('/devices/', { push_token, platform }),
      unregister: (push_token: string) => http.post<void>('/devices/unregister/', { push_token }),
    },

    habits: {
      list: (status?: HabitStatus) => listAll<Habit>('/habits/', status ? { status } : undefined),
      get: (id: ID) => http.get<Habit>(`/habits/${id}/`),
      create: (body: HabitWrite) => http.post<Habit>('/habits/', body),
      update: (id: ID, patch: Partial<HabitWrite>) => http.patch<Habit>(`/habits/${id}/`, patch),
      /** Soft delete (status -> DELETED). */
      remove: (id: ID) => http.delete<void>(`/habits/${id}/`),
      /** `until` is an optional YYYY-MM-DD. */
      pause: (id: ID, until?: string) => http.post<Habit>(`/habits/${id}/pause/`, until ? { until } : {}),
      resume: (id: ID) => http.post<Habit>(`/habits/${id}/resume/`),
      streak: (id: ID) => http.get<Streak>(`/habits/${id}/streak/`),
      /** NOT paginated. Occurrences exist for past days and up to ~7 days ahead only. */
      occurrences: (id: ID, range: { from: string; to: string }) =>
        http.get<Occurrence[]>(`/habits/${id}/occurrences/`, { query: range }),
      /** `date` defaults to "today" in the user's account time zone. */
      checklist: (date?: string) => http.get<Checklist>('/habits/checklist/', { query: { date } }),
    },

    occurrences: {
      complete: (occurrenceId: ID, body: CompletionInput = {}) =>
        http.post<OccurrenceActionResponse>(`/occurrences/${occurrenceId}/complete/`, body),
      skip: (occurrenceId: ID, body: SkipInput = {}) =>
        http.post<OccurrenceActionResponse>(`/occurrences/${occurrenceId}/skip/`, body),
    },

    skipReasons: {
      list: () => listAll<SkipReason>('/skip-reasons/'),
    },

    rewards: {
      /** Legacy points system - prefer points.summary() for anything shown to the user. */
      me: () => http.get<UserReward>('/rewards/me/'),
    },

    points: {
      summary: () => http.get<PointsSummary>('/points/summary/'),
      history: () => listAll<PointTransaction>('/points/'),
    },

    badges: {
      /** All badges with `unlocked` / `progress` filled in for the current user. Use this one. */
      list: () => http.get<Badge[]>('/badges/'),
      /** Only the unlocked ones, in a smaller shape (UserBadge). */
      mine: () => http.get<UserBadge[]>('/badges/mine/'),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
