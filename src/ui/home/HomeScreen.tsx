/**
 * L4 — HomeScreen: the app entry (/). The generation form is the hero (compose the existing
 * SetupScreen), with the learning summary (streak, due, continue, mastery, weekly, recent) stacked
 * below by reusing DashboardScreen. Presentational: setup props + a projected DashboardSnapshot are
 * injected; navigation is delegated. No dashboard/setup logic is duplicated here.
 */

import type { CSSProperties } from 'react';
import { SetupScreen, type SetupScreenProps } from '../setup/SetupScreen';
import { DashboardScreen } from '../dashboard/DashboardScreen';
import { colors, fonts } from '../theme/tokens';
import type { DashboardSnapshot } from '../../domain/dashboard/dashboardProjector';

export interface HomeScreenProps {
  setup: SetupScreenProps;
  snapshot?: DashboardSnapshot;
  now?: number;
  onContinue?: () => void;
  onStartReview?: () => void;
  onOpenPassage?: (passageId: string) => void;
}

export function HomeScreen({ setup, snapshot, now, onContinue, onStartReview, onOpenPassage }: HomeScreenProps) {
  return (
    <div className="home-page">
      <SetupScreen {...setup} />
      {snapshot ? (
        <div style={summaryWrapStyle}>
          <div style={summaryHeadingStyle}>学習の状況</div>
          <DashboardScreen
            snapshot={snapshot}
            now={now}
            onContinue={onContinue ? () => onContinue() : undefined}
            onStartReview={onStartReview}
            onOpenPassage={onOpenPassage ? (passageId) => onOpenPassage(passageId) : undefined}
          />
        </div>
      ) : null}
    </div>
  );
}

const summaryWrapStyle: CSSProperties = { background: colors.surfacePage, paddingTop: 8 };
const summaryHeadingStyle: CSSProperties = {
  fontFamily: fonts.serifJp,
  fontSize: 18,
  fontWeight: 500,
  color: colors.ink,
  padding: '24px 32px 0',
};
