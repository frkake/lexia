/**
 * L4 — MasteryDot: the small circular mastery indicator used in study-word lists,
 * review progress and the wordbook (design.md "習熟度ドット"). 7–9px circle colored by
 * the four mastery tokens; a stage-less dot renders the inactive track color.
 */

import { masteryColors, colors } from '../theme/tokens';
import type { MasteryStage } from '../../types/domain';

/** Resolve a dot's fill from its stage (inactive token when undefined). */
export function masteryDotColor(stage?: MasteryStage): string {
  return stage ? masteryColors[stage] : colors.dotInactive;
}

export interface MasteryDotProps {
  stage?: MasteryStage;
  /** Diameter in px (mock uses 7–9). */
  size?: number;
}

export function MasteryDot({ stage, size = 7 }: MasteryDotProps) {
  return (
    <span
      data-testid="mastery-dot"
      data-stage={stage ?? 'inactive'}
      style={{
        display: 'inline-block',
        flex: 'none',
        width: size,
        height: size,
        borderRadius: '50%',
        background: masteryDotColor(stage),
      }}
    />
  );
}
