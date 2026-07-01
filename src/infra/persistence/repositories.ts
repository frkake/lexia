/**
 * L2 — repository factory: binds every persistence port to its Dexie implementation
 * against one open LexiaDb instance (one DB per learner namespace).
 */

import type {
  SchedulingRepository,
  ReviewLogRepository,
  PassageRepository,
  TimingMapRepository,
  ProgressRepository,
  SettingsRepository,
  WordCacheRepository,
  StoryRepository,
} from '../../types/ports';
import type { LexiaDb } from './lexiaDb';
import { DexieSchedulingRepository } from './schedulingRepository';
import { DexieReviewLogRepository } from './reviewLogRepository';
import { DexiePassageRepository } from './passageRepository';
import { DexieTimingMapRepository } from './timingMapRepository';
import { DexieProgressRepository } from './progressRepository';
import { DexieSettingsRepository } from './settingsRepository';
import { DexieWordCacheRepository } from './wordCacheRepository';
import { DexieStoryRepository } from './storyRepository';

export interface Repositories {
  scheduling: SchedulingRepository;
  reviewLog: ReviewLogRepository;
  passages: PassageRepository;
  timingMaps: TimingMapRepository;
  progress: ProgressRepository;
  settings: SettingsRepository;
  wordCache: WordCacheRepository;
  stories: StoryRepository;
}

export function createRepositories(db: LexiaDb): Repositories {
  return {
    scheduling: new DexieSchedulingRepository(db),
    reviewLog: new DexieReviewLogRepository(db),
    passages: new DexiePassageRepository(db),
    timingMaps: new DexieTimingMapRepository(db),
    progress: new DexieProgressRepository(db),
    settings: new DexieSettingsRepository(db),
    wordCache: new DexieWordCacheRepository(db),
    stories: new DexieStoryRepository(db),
  };
}

export { DexieSchedulingRepository } from './schedulingRepository';
export { DexieReviewLogRepository } from './reviewLogRepository';
export { DexiePassageRepository } from './passageRepository';
export { DexieTimingMapRepository } from './timingMapRepository';
export { DexieProgressRepository } from './progressRepository';
export { DexieSettingsRepository } from './settingsRepository';
export { DexieWordCacheRepository } from './wordCacheRepository';
export { DexieStoryRepository } from './storyRepository';
