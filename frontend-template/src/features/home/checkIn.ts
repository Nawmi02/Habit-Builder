import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { apiActionFor, moodToApi, requiresSkipReason } from '../../api/mappers';
import type { Badge } from '../../api/types';
import type { CheckInRequest } from '../../components/CompletionSheet';
import { newlyUnlocked } from '../../lib/badges';

/**
 * Performs one check-in against the real endpoints and returns any badges it just unlocked.
 *
 *   GOOD: success -> POST /occurrences/{id}/complete/    skip -> POST .../skip/ (reason required)
 *   BAD : success ("I resisted") -> POST .../skip/       slip -> POST .../complete/
 *
 * There is no undo endpoint, so callers must not promise one (see backend asks).
 */
export async function performCheckIn(req: CheckInRequest, qc: QueryClient): Promise<Badge[]> {
  const { item } = req;
  const action = apiActionFor(item.habit_type, req.intent);
  if (!action) throw new Error('That action is not available for this habit.');
  if (requiresSkipReason(item.habit_type, action) && !req.skipReasonId) throw new Error('Please pick a reason for skipping.');

  // The complete/skip responses don't say whether a badge unlocked, so diff the list.
  const before = qc.getQueryData<Badge[]>(['badges']) ?? (await api.badges.list().catch((): Badge[] => []));

  if (action === 'complete') {
    await api.occurrences.complete(item.occurrence_id, {
      progress_value: req.progress, // undefined for yes/no -> server defaults to the target
      mood: req.mood ? moodToApi(req.mood) : undefined,
      note: req.note,
    });
  } else {
    await api.occurrences.skip(item.occurrence_id, {
      skip_reason_id: requiresSkipReason(item.habit_type, action) ? req.skipReasonId : undefined,
      note: req.note,
    });
  }

  const after = await api.badges.list().catch(() => before);
  qc.setQueryData(['badges'], after);
  return newlyUnlocked(before, after);
}
