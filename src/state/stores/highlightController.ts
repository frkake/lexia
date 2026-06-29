/**
 * L3 — HighlightController core: maps a playback time to the active token via binary
 * search over a time-ordered TimingMap (design.md "PlayerStore + HighlightController").
 * Pure and O(log n) so the rAF follow-along loop stays cheap; the PlayerStore calls
 * `findActiveTokenId` each frame and toggles the highlighted span.
 */

import type { TokenId, WordMark } from '../../types/domain';

/**
 * The tokenId active at `timeMs`, or null when before the first / after the last mark
 * or inside a gap. `marks` must be ascending by `startMs` (the synthesis adapter
 * guarantees reading order).
 */
export function findActiveTokenId(marks: readonly WordMark[], timeMs: number): TokenId | null {
  if (marks.length === 0) return null;

  // Largest index whose startMs <= timeMs.
  let lo = 0;
  let hi = marks.length - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (marks[mid]!.startMs <= timeMs) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (candidate < 0) return null;
  const mark = marks[candidate]!;
  return timeMs < mark.endMs ? mark.tokenId : null;
}
