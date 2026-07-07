/**
 * L4 — InlineNoticePopover (D-1 mobile fallback): on a narrow viewport the learning rail is stacked
 * far below the prose, so scrolling a tapped notice into the rail would teleport the reader away and
 * lose their place. Instead, tapping an in-text notice badge opens this small popover anchored right
 * under the badge — the cue's category chip, its explanation, and a close button — WITHOUT scrolling,
 * so the reading position is preserved (acceptance: post-tap scroll change ≤50px). It is positioned
 * `absolute` so it overlays the following text rather than reflowing it (which would move the badge).
 */

import type { CSSProperties } from 'react';
import { colors, fonts, noticeStyle, radius, shadow } from '../theme/tokens';
import type { NoticeCue } from '../../types/domain';

export interface InlineNoticePopoverProps {
  cue: NoticeCue;
  /** Unified guide number shown in the badge, so the popover title matches the prose marker. */
  displayIndex?: number;
  onClose: () => void;
}

export function InlineNoticePopover({ cue, displayIndex, onClose }: InlineNoticePopoverProps) {
  const style = noticeStyle(cue.category);
  return (
    <span
      role="dialog"
      aria-label={`気づき${displayIndex ?? cue.index} ${style.label}`}
      data-testid={`inline-notice-popover-${cue.index}`}
      className="inline-notice-popover"
      style={popoverStyle}
      // Keep taps inside the popover from bubbling to the badge (which would toggle it shut).
      onClick={(event) => event.stopPropagation()}
    >
      <span style={headerStyle}>
        <span style={{ ...chipStyle, color: style.color, background: style.bg }}>{style.label}</span>
        <button
          type="button"
          aria-label="気づきを閉じる"
          data-testid={`inline-notice-close-${cue.index}`}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          style={closeStyle}
        >
          ×
        </button>
      </span>
      {/* 本文中での意味を最初に (meaningJa); 使い方の洞察 (explanationJa) はその後。 */}
      {cue.meaningJa ? (
        <span data-testid={`inline-notice-meaning-${cue.index}`} style={meaningStyle}>
          {cue.meaningJa}
        </span>
      ) : null}
      <span style={explanationStyle}>{cue.explanationJa}</span>
    </span>
  );
}

const popoverStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  zIndex: 30,
  marginTop: 6,
  display: 'block',
  width: 'max-content',
  minWidth: 190,
  maxWidth: 'min(320px, 78vw)',
  textAlign: 'left',
  whiteSpace: 'normal',
  cursor: 'auto',
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  boxShadow: shadow.card,
  padding: '10px 12px',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 6,
};

const chipStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '.03em',
  borderRadius: 4,
  padding: '2px 7px',
  whiteSpace: 'nowrap',
};

const closeStyle: CSSProperties = {
  width: 28,
  height: 28,
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: '50%',
  background: colors.surfaceSubtle,
  color: colors.inkSoft,
  fontSize: 14,
  lineHeight: 1,
  cursor: 'pointer',
};

/** 本文中での意味 — leads the popover body, above the usage insight. */
const meaningStyle: CSSProperties = {
  display: 'block',
  fontFamily: fonts.bodyJp,
  fontSize: 12.5,
  fontWeight: 600,
  lineHeight: 1.6,
  color: colors.ink,
  letterSpacing: 'normal',
  marginBottom: 4,
};

const explanationStyle: CSSProperties = {
  display: 'block',
  fontFamily: fonts.bodyJp,
  fontSize: 12.5,
  lineHeight: 1.6,
  color: colors.inkSoft,
  letterSpacing: 'normal',
};
