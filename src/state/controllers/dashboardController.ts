/**
 * L3 — dashboardController: reads the fixtures the DashboardProjector needs and projects
 * the DashboardSnapshot (design.md "DashboardProjector", tasks 10.3/9.3). All-states are
 * read through an injected `loadStates` reader (the composition root closes over the DB,
 * mirroring `useScheduling`) because New words carry no `stability` index and so are
 * invisible to the repository's `lowStability` query. The review log is read in full so
 * the streak and weekly window are correct.
 */

import { dashboardProjector, type DashboardSnapshot } from '../../domain/dashboard/dashboardProjector';
import type { ProgressRepository, ReviewLogRepository, PassageRepository } from '../../types/ports';
import type { UserId, WordSchedulingState } from '../../types/domain';

export interface DashboardControllerDeps {
  /** Reads every scheduling state for the learner (incl. New words). */
  loadStates: (userId: UserId) => Promise<WordSchedulingState[]>;
  progress: ProgressRepository;
  reviewLog: ReviewLogRepository;
  passages: PassageRepository;
  /** Max recent passages to load for resolving in-progress reading titles (default 20). */
  passageLimit?: number;
}

export async function loadDashboardSnapshot(
  deps: DashboardControllerDeps,
  userId: UserId,
  now: number,
  /** Learner's local offset from UTC in minutes (F-4; JST = +540). Defaults to 0 = UTC. */
  tzOffsetMinutes = 0,
): Promise<DashboardSnapshot> {
  // A modest window of recent passages backs the in-progress reading cards (title / level
  // resolution). In-progress passages are among the most recent, so this covers them.
  const passageLimit = deps.passageLimit ?? 20;
  const [states, inProgress, log, passages] = await Promise.all([
    deps.loadStates(userId),
    deps.progress.byStatus(userId, 'in_progress'),
    deps.reviewLog.since(userId, 0),
    deps.passages.recent(userId, passageLimit),
  ]);

  return dashboardProjector.project({
    now,
    states,
    progress: inProgress,
    log,
    passages,
    tzOffsetMinutes,
  });
}
