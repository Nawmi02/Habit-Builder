import test from 'node:test';
import assert from 'node:assert/strict';
import { planReminders, MIN_GAP_MINUTES, type PlanInput, type PlanItem, type ReminderIntensity } from '../src/lib/reminders';

// NOTE: run with TZ pinned (run-tests.sh sets TZ=Asia/Dhaka). Times are the phone's local clock.
const TODAY = '2026-10-21';
const at = (date: string, h: number, m = 0) => {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0);
};
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

let nextId = 1;
const item = (over: Partial<PlanItem> = {}): PlanItem => ({
  occurrenceId: nextId++, habitId: nextId, name: 'Meditate', emoji: '🍃', habitType: 'GOOD', status: 'PENDING', reminderTime: '08:00', ...over,
});

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  now: at(TODAY, 6, 0),
  intensity: 'intense',
  masterEnabled: true,
  streakAlertEnabled: false,
  days: [{ date: TODAY, items: [item()] }],
  ...over,
});

test('master switch off -> nothing is scheduled', () => {
  assert.deepEqual(planReminders(input({ masterEnabled: false })), []);
});

test('GENTLE: just the habit reminder, no ladder', () => {
  const plan = planReminders(input({ intensity: 'gentle' }));
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, 'habit');
  assert.equal(hhmm(plan[0].fireAt), '08:00');
});

test('MOTIVATED: reminder + mid-day nudge + 20:00 evening nudge (3 total)', () => {
  const plan = planReminders(input({ intensity: 'motivated' }));
  assert.deepEqual(plan.map((p) => hhmm(p.fireAt)), ['08:00', '12:00', '20:00']);
});

test('MOTIVATED with a late reminder skips the mid-day nudge instead of crowding the evening', () => {
  const plan = planReminders(input({ intensity: 'motivated', days: [{ date: TODAY, items: [item({ reminderTime: '17:00' })] }] }));
  assert.deepEqual(plan.map((p) => hhmm(p.fireAt)), ['17:00', '20:00']);
});

test('INTENSE: reminder, then every 2h, escalating tone, final call at 23:00', () => {
  const plan = planReminders(input());
  assert.deepEqual(plan.map((p) => hhmm(p.fireAt)), ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '23:00']);
  assert.deepEqual(plan.map((p) => p.level), [1, 2, 2, 2, 3, 3, 3, 4], 'tone escalates as the day runs out');
  assert.equal(plan[plan.length - 1].kind, 'ladder');
  assert.match(plan[plan.length - 1].title, /last hour|final call|midnight/i);
});

test('finishing everything cancels the nagging: no pending habits -> no notifications for that day', () => {
  const plan = planReminders(input({ days: [{ date: TODAY, items: [item({ status: 'COMPLETED' }), item({ status: 'SKIPPED' })] }] }));
  assert.deepEqual(plan, []);
});

test("completing ONE of two habits keeps the ladder but drops that habit's own reminder", () => {
  const done = item({ status: 'COMPLETED', name: 'Run', habitId: 100 });
  const left = item({ name: 'Read', habitId: 200, emoji: '📚' });
  const plan = planReminders(input({ days: [{ date: TODAY, items: [done, left] }] }));
  assert.ok(plan.every((p) => !p.key.includes('|100|')), 'nothing for the completed habit');
  assert.ok(plan.some((p) => p.kind === 'habit' && p.key.includes('|200|')));
  const ladder = plan.find((p) => p.kind === 'ladder');
  assert.match(ladder?.body ?? '', /Read is still waiting|Read.*is/);
});

test('ladder text names the first pending habit and counts the rest', () => {
  const plan = planReminders(input({ days: [{ date: TODAY, items: [item({ name: 'Read', emoji: '📚' }), item({ name: 'Run' }), item({ name: 'Yoga' })] }] }));
  const ladder = plan.find((p) => p.kind === 'ladder');
  assert.match(ladder?.body ?? '', /📚 Read and 2 more are/);
});

test('past times are dropped (planning at 15:30 starts at 16:00)', () => {
  const plan = planReminders(input({ now: at(TODAY, 15, 30) }));
  assert.equal(hhmm(plan[0].fireAt), '16:00');
  assert.ok(plan.every((p) => p.fireAt.getTime() > at(TODAY, 15, 30).getTime()));
});

test('BAD habit reminder asks a check-in question instead of "do it"', () => {
  const plan = planReminders(input({ days: [{ date: TODAY, items: [item({ habitType: 'BAD', name: 'No Junk Food' })] }] }));
  assert.match(plan[0].body, /stay strong/i);
});

test('habit with reminders off still gets the shared ladder, starting from 09:00', () => {
  const plan = planReminders(input({ days: [{ date: TODAY, items: [item({ reminderTime: null })] }] }));
  assert.ok(plan.every((p) => p.kind === 'ladder'));
  assert.deepEqual(plan.map((p) => hhmm(p.fireAt)), ['11:00', '13:00', '15:00', '17:00', '19:00', '21:00', '23:00']);
});

test('STREAK ALERT: 20:00 alert replaces the ladder nudge at the same time; unknown streak makes no claim', () => {
  const withStreak = planReminders(input({ streakAlertEnabled: true, days: [{ date: TODAY, items: [item({ name: 'Run', currentStreak: 12 })] }] }));
  const at20 = withStreak.filter((p) => hhmm(p.fireAt) === '20:00');
  assert.equal(at20.length, 1, 'only one notification at 20:00');
  assert.equal(at20[0].kind, 'streak');
  assert.match(at20[0].title, /12-day streak at risk/);

  const unknown = planReminders(input({ streakAlertEnabled: true, days: [{ date: TODAY, items: [item({ currentStreak: undefined })] }] }));
  assert.ok(unknown.every((p) => p.kind !== 'streak'));
  const short = planReminders(input({ streakAlertEnabled: true, days: [{ date: TODAY, items: [item({ currentStreak: 2 })] }] }));
  assert.ok(short.every((p) => p.kind !== 'streak'), 'streaks under 3 are not worth alarming about');
});

test('collision: a habit reminder 10 min after a ladder nudge wins (named beats generic)', () => {
  const a = item({ reminderTime: '08:00', habitId: 1 });
  const b = item({ reminderTime: '10:10', habitId: 2, name: 'Stretch' });
  const plan = planReminders(input({ days: [{ date: TODAY, items: [a, b] }] }));
  assert.ok(!plan.some((p) => hhmm(p.fireAt) === '10:00'), 'the 10:00 ladder nudge was dropped');
  assert.ok(plan.some((p) => hhmm(p.fireAt) === '10:10' && p.kind === 'habit'));
});

test('plans several days ahead, but only for days that still have pending habits', () => {
  const plan = planReminders(input({
    intensity: 'gentle',
    days: [
      { date: TODAY, items: [item({ status: 'COMPLETED' })] },
      { date: '2026-10-22', items: [item()] },
      { date: '2026-10-23', items: [item()] },
    ],
  }));
  assert.deepEqual(plan.map((p) => p.data.date), ['2026-10-22', '2026-10-23']);
});

test('hard cap keeps the NEAREST notifications (iOS allows only 64)', () => {
  const days = ['2026-10-21', '2026-10-22', '2026-10-23'].map((date) => ({ date, items: [item()] }));
  const all = planReminders(input({ days, maxScheduled: 1000 }));
  const capped = planReminders(input({ days, maxScheduled: 5 }));
  assert.equal(capped.length, 5);
  assert.deepEqual(capped.map((p) => p.key), all.slice(0, 5).map((p) => p.key));
  // and the default cap really is below the iOS limit:
  const many = Array.from({ length: 3 }, (_, i) => ({
    date: `2026-10-${21 + i}`,
    items: Array.from({ length: 12 }, (_, j) => item({ habitId: 1000 * i + j, reminderTime: `${String(6 + j).padStart(2, '0')}:05` })),
  }));
  assert.ok(planReminders(input({ days: many })).length <= 60);
});

test('INVARIANTS over many random inputs: sorted, >= min gap, future only, unique keys, within cap', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const intensities: ReminderIntensity[] = ['gentle', 'motivated', 'intense'];
  for (let run = 0; run < 300; run++) {
    const now = at(TODAY, Math.floor(rnd() * 24), Math.floor(rnd() * 60));
    const days = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, d) => ({
      date: `2026-10-${21 + d}`,
      items: Array.from({ length: Math.floor(rnd() * 8) }, (_, j) =>
        item({
          habitId: d * 100 + j,
          status: rnd() < 0.3 ? 'COMPLETED' : 'PENDING',
          reminderTime: rnd() < 0.2 ? null : `${String(Math.floor(rnd() * 24)).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`,
          currentStreak: rnd() < 0.5 ? Math.floor(rnd() * 20) : undefined,
        }),
      ),
    }));
    const plan = planReminders({ now, intensity: intensities[Math.floor(rnd() * 3)], masterEnabled: true, streakAlertEnabled: rnd() < 0.5, days });
    const keys = new Set(plan.map((p) => p.key));
    assert.equal(keys.size, plan.length, `unique keys (run ${run})`);
    assert.ok(plan.length <= 60, `cap (run ${run})`);
    for (let i = 0; i < plan.length; i++) {
      assert.ok(plan[i].fireAt.getTime() > now.getTime(), `future only (run ${run})`);
      if (i > 0) {
        const gap = plan[i].fireAt.getTime() - plan[i - 1].fireAt.getTime();
        assert.ok(gap >= MIN_GAP_MINUTES * 60000, `gap >= ${MIN_GAP_MINUTES}min (run ${run}, ${hhmm(plan[i - 1].fireAt)} -> ${hhmm(plan[i].fireAt)})`);
      }
    }
  }
});
