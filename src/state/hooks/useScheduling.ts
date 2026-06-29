/**
 * L3 — useScheduling: reactively reads due / mastery state from Dexie via
 * `useLiveQuery`, so any write through a repository re-renders the screen immediately
 * (design.md "useScheduling …和 sessionStore", 1.5/10.3/11.1). The view derivation is a
 * pure async reader (`readSchedulingView`) so the logic is testable without React; the
 * hook is a thin live-query wrapper.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { masteryProjector } from '../../domain/srs/masteryProjector';
import type { LexiaDb } from '../../infra/persistence/lexiaDb';
import type { MasteryStage, UserId, WordSchedulingState } from '../../types/domain';

export type MasteryCounts = Record<MasteryStage, number> & { total: number };

export interface SchedulingView {
  all: WordSchedulingState[];
  /** Learned words due at/before `now`, due-soonest first. */
  due: WordSchedulingState[];
  mastery: MasteryCounts;
}

/** Pure reader: derive the scheduling view from the learner's stored states. */
export async function readSchedulingView(
  db: LexiaDb,
  userId: UserId,
  now: number,
): Promise<SchedulingView> {
  const all = await db.scheduling.where('userId').equals(userId).toArray();

  const due = all
    .filter((s) => s.stability !== undefined && s.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt);

  const mastery: MasteryCounts = { New: 0, Learning: 0, Consolidating: 0, Mastered: 0, total: all.length };
  for (const s of all) {
    mastery[masteryProjector.deriveMastery(s, { kind: 'none' })] += 1;
  }

  return { all, due, mastery };
}

/** Live, re-rendering scheduling view (undefined until the first read resolves). */
export function useScheduling(db: LexiaDb, userId: UserId): SchedulingView | undefined {
  return useLiveQuery(() => readSchedulingView(db, userId, Date.now()), [db, userId]);
}
