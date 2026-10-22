import type { Checklist, ChecklistItem, ChecklistSummary, TimeOfDay } from '../api/types';

const ORDER: TimeOfDay[] = ['MORNING', 'AFTERNOON', 'EVENING', 'ANYTIME'];

/** The API groups items by time of day; the prototype shows one flat list in that order. */
export function flattenChecklist(c: Checklist | undefined): ChecklistItem[] {
  if (!c) return [];
  return ORDER.flatMap((k) => c.groups?.[k] ?? []);
}

/**
 * "3 of 6 done": a habit counts as handled once it's no longer pending/missed, i.e.
 * completed OR skipped (skipped = avoided, for a BAD habit).
 */
export function progressOf(s: ChecklistSummary | undefined): { done: number; total: number; fraction: number } {
  if (!s || s.total <= 0) return { done: 0, total: 0, fraction: 0 };
  const done = Math.min(s.total, s.completed + s.skipped);
  return { done, total: s.total, fraction: done / s.total };
}

export function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
