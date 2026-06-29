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
  /** Max recently-read passages to surface (default 5). */
  recentLimit?: number;
}

export async function loadDashboardSnapshot(
  deps: DashboardControllerDeps,
  userId: UserId,
  now: number,
): Promise<DashboardSnapshot> {
  const recentLimit = deps.recentLimit ?? 5;
  const [states, inProgress, completed, log, passages] = await Promise.all([
    deps.loadStates(userId),
    deps.progress.byStatus(userId, 'in_progress'),
    deps.progress.byStatus(userId, 'completed'),
    deps.reviewLog.since(userId, 0),
    deps.passages.recent(userId, recentLimit),
  ]);

  return dashboardProjector.project({
    now,
    states,
    progress: [...inProgress, ...completed],
    log,
    passages,
    recentLimit,
  });
}
