/**
 * API contract types - written from the Django REST serializers in the backend repo
 * (apps/users, apps/habits, apps/gamification). If the backend changes, change this file
 * first; the rest of the app imports from here.
 *
 * Conventions in the backend:
 *  - Every URL ends with a trailing slash.
 *  - Dates are "YYYY-MM-DD", datetimes are ISO-8601 UTC, times are "HH:MM:SS".
 *  - Weekdays are 0 = MONDAY ... 6 = SUNDAY (the prototype uses 0 = Sunday - see mappers.ts).
 *  - List endpoints that use DRF's default pagination return Paginated<T>.
 *    Exceptions (plain arrays): /badges/, /badges/mine/, /devices/, /habits/{id}/occurrences/.
 */

export type ID = number;

export interface Paginated<T> {
  count: number;
  next: string | null; // absolute URL
  previous: string | null;
  results: T[];
}

// ---------- users ----------

export type ThemeSetting = 'LIGHT' | 'DARK' | 'SYSTEM';

export interface User {
  user_id: ID;
  name: string;
  email: string;
  time_zone: string; // IANA, e.g. "Asia/Dhaka"
  notifications_enabled: boolean;
  theme: ThemeSetting;
  created_at: string;
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  name: string;
  password: string; // min 8 chars + Django password validators
  time_zone: string;
}

export interface RegisterResponse extends AuthTokens {
  user: User;
}

export type UserUpdate = Partial<Pick<User, 'name' | 'time_zone' | 'notifications_enabled' | 'theme'>>;

export type DevicePlatform = 'ANDROID' | 'IOS' | 'WEB';

export interface DeviceToken {
  device_id: ID;
  user_id: ID;
  push_token: string;
  platform: DevicePlatform;
  last_active: string;
}

// ---------- habits ----------

export type HabitType = 'GOOD' | 'BAD';
export type TargetType = 'YES_NO' | 'COUNT' | 'DURATION';
export type TimeOfDay = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'ANYTIME';
export type HabitStatus = 'ACTIVE' | 'PAUSED' | 'DELETED';
export type FrequencyType = 'DAILY' | 'WEEKDAYS' | 'TIMES_PER_WEEK';
export type OccurrenceStatus = 'PENDING' | 'COMPLETED' | 'MISSED' | 'SKIPPED';

export interface HabitSchedule {
  schedule_id: ID;
  habit_id: ID;
  frequency_type: FrequencyType;
  weekdays: number[]; // 0 = Monday
  times_per_week: number | null;
  target_time: string | null;
  reminder_time: string | null; // "HH:MM:SS"
  pause_start: string | null;
  pause_end: string | null;
  skip_allowed: boolean;
  max_skip_per_period: number | null;
}

export interface Habit {
  habit_id: ID;
  user_id: ID;
  name: string;
  habit_type: HabitType;
  icon: string; // we store the emoji here
  color: string; // "#RRGGBB"
  target_type: TargetType;
  target_value: number;
  target_unit: string;
  time_of_day: TimeOfDay;
  status: HabitStatus;
  start_date: string;
  created_at: string;
  updated_at: string;
  schedule?: HabitSchedule;
}

/** What we POST/PATCH. status and ids are read-only on the server. */
export interface HabitWrite {
  name: string;
  habit_type: HabitType;
  icon: string;
  color: string;
  target_type: TargetType;
  target_value: number;
  target_unit: string;
  time_of_day: TimeOfDay;
  start_date: string;
  schedule: ScheduleWrite;
}

export interface ScheduleWrite {
  frequency_type: FrequencyType;
  weekdays: number[];
  times_per_week?: number | null;
  reminder_time: string | null;
  skip_allowed: boolean;
}

export interface Occurrence {
  occurrence_id: ID;
  habit_id: ID;
  scheduled_date: string;
  deadline_at: string;
  started_at?: string | null;
  status: OccurrenceStatus;
}

/** Item of GET /habits/checklist/ (occurrence + denormalised habit fields). */
export interface ChecklistItem extends Occurrence {
  name: string;
  icon: string;
  color: string;
  habit_type: HabitType;
  target_type: TargetType;
  target_value: number;
  target_unit: string;
  time_of_day: TimeOfDay;
}

export interface ChecklistSummary {
  total: number;
  completed: number;
  pending: number;
  missed: number;
  skipped: number;
  percent: number;
}

export interface Checklist {
  date: string;
  summary: ChecklistSummary;
  groups: Record<TimeOfDay, ChecklistItem[]>;
}

export interface Streak {
  streak_id: ID;
  habit_id: ID;
  current_streak: number;
  best_streak: number;
  last_completed_date: string | null;
  last_skipped_date: string | null;
  strength_score: number;
  freeze_count: number;
  updated_at: string;
}

export interface SkipReason {
  reason_id: ID;
  name: string;
  description: string;
  is_active: boolean;
}

/** Backend mood values accepted by `mood` (free text on the server, we use these 5). */
export type ApiMood = 'GREAT' | 'GOOD' | 'NEUTRAL' | 'LOW' | 'BAD';

export interface CompletionInput {
  progress_value?: number;
  completed_at?: string;
  source?: 'APP' | 'REMINDER' | 'SYNC';
  note?: string;
  mood?: ApiMood | '';
}

export interface SkipInput {
  skip_reason_id?: ID | null;
  source?: 'APP' | 'REMINDER' | 'SYNC';
  note?: string;
}

export interface CompletionRecord {
  completion_id: ID;
  occurrence_id: ID;
  progress_value: number;
  completed_at: string | null;
  source: 'APP' | 'REMINDER' | 'SYNC';
  note: string;
  mood: string;
  skip_reason_id: ID | null;
  synced_at: string | null;
}

/**
 * NOTE: `reward` here comes from habits.UserReward, which is a SECOND points system that
 * does not include daily/streak bonuses. For XP/level shown in the UI always use
 * GET /points/summary/ (PointsSummary), not this.
 */
export interface UserReward {
  reward_id: ID;
  user_id: ID;
  total_points: number;
  level: number;
  updated_at: string;
}

export interface OccurrenceActionResponse {
  completion: CompletionRecord;
  streak: Streak;
  reward: UserReward;
}

// ---------- gamification ----------

export interface PointsSummary {
  total_points: number;
  level: number;
  next_level_at: number;
  points_to_next_level: number;
  checkins: number;
  badges_unlocked: number;
}

export type PointRelatedType = 'COMPLETION' | 'DAILY_BONUS' | 'STREAK' | 'BADGE';

export interface PointTransaction {
  point_id: ID;
  user_id: ID;
  completion_id: ID | null;
  related_type: PointRelatedType;
  points: number;
  reason: string;
  created_at: string;
}

export type BadgeConditionType = 'TOTAL_CHECKINS' | 'STREAK_DAYS' | 'TOTAL_POINTS';

export interface Badge {
  badge_id: ID;
  code: string;
  name: string;
  description: string;
  condition_type: BadgeConditionType;
  condition_value: number;
  unlocked: boolean;
  unlocked_at: string | null;
  progress: number; // capped at condition_value
}

/** Item of GET /badges/mine/ - a different (smaller) shape than Badge. Prefer GET /badges/. */
export interface UserBadge {
  user_badge_id: ID;
  user_id: ID;
  badge_id: ID;
  code: string;
  name: string;
  description: string;
  unlocked_at: string;
}

export interface ReminderRecord {
  reminder_id: ID;
  occurrence_id: ID;
  reminder_type: 'LOCAL' | 'PUSH';
  escalation_level: number;
  scheduled_at: string;
  status: 'PENDING' | 'SENT' | 'CANCELLED' | 'FAILED';
  sent_at: string | null;
  delivery_status: string;
}
