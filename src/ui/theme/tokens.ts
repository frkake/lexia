/**
 * L4 — design tokens (single source of truth for visual fidelity).
 *
 * Values are the machine-extracted constants from design.md "Design Tokens", whose
 * visual basis is the 6 mock frames in `英単語学習サイト.dc.html`. UI components and the
 * visual-regression tests (task 11.4) consume these only; introducing a new color/size
 * means updating design.md and this module together. The matching CSS custom properties
 * live in `global.css`; this TS mirror lets components and tests reference token values
 * directly (e.g. the load-bearing mastery / annotation encodings).
 */

import type { MasteryStage, MasteryDensity, NoticeCategory } from '../../types/domain';

export const colors = {
  // brand / primary
  primary: '#3D6CB0',
  primaryDeep: '#2D518C',
  primarySoft: '#7C9BC4',
  primaryBorder: '#CBD8E8',
  primaryBorder2: '#DCE6F2',
  // ink / text
  ink: '#1E2630',
  body: '#27313D',
  inkSoft: '#5A6675',
  muted: '#717E8C',
  faint: '#9AA4B1',
  faint2: '#8A95A3',
  fainter: '#B6BFC9',
  // accents
  green: '#4C9A86',
  greenDeep: '#3E8C79',
  greenBg: '#E6F2EE',
  greenBorder: '#BFDFD5',
  terracotta: '#C07A63',
  terracottaSoft: '#B6886F',
  terracottaBorder: '#E4D2CC',
  /** Deepened terracotta for the idiom group's active "Spotlight Link" ring (≥3:1 on white). */
  terracottaDeep: '#A65A41',
  register: '#6B7686',
  // surfaces
  surfacePage: '#F6F8FA',
  surfaceCard: '#FFFFFF',
  surfaceSubtle: '#F4F7FA',
  surfaceBlue: '#EEF3FA',
  surfaceCollocation: '#E4EDF8',
  highlight: '#DCE8F6',
  avatarBg: '#D8E0EA',
  shellDark: '#10151C',
  // borders / dividers
  borderCard: '#E8ECF2',
  borderControl: '#E4E8EE',
  dividerSection: '#EEF1F5',
  dividerRow: '#F0F2F5',
  track: '#EEF1F5',
  dotInactive: '#CBD3DD',
} as const;

/** Four-stage mastery colors — the most important semantic encoding. */
export const masteryColors: Record<MasteryStage, string> = {
  New: '#C4CCD6',
  Learning: '#8FB0DA',
  Consolidating: '#4C7BC0',
  Mastered: '#4C9A86',
};

export type UnderlineStyle = 'solid' | 'dotted';

/**
 * Passage-annotation visual encoding by `MasteryDensity` (4→3 downcast).
 * design.md "状態別注釈エンコード": 新出 solid #4C7BC0 / 学習中 solid #8FB0DA /
 * 定着・再登場 dotted #C4CCD6.
 */
export const annotationEncoding: Record<MasteryDensity, { underlineStyle: UnderlineStyle; color: string }> = {
  new: { underlineStyle: 'solid', color: '#4C7BC0' },
  review: { underlineStyle: 'solid', color: '#8FB0DA' },
  known: { underlineStyle: 'dotted', color: '#C4CCD6' },
};

export interface NoticeStyle {
  label: string;
  /** Chip text color. */
  color: string;
  /** Chip background. */
  bg: string;
  /** Circled-number badge color. */
  numberColor: string;
}

/** Visual grouping for the 10 notice categories into the 3 documented chip styles. */
const CONNOTATION: Omit<NoticeStyle, 'label'> = { color: colors.greenDeep, bg: '#E6F2EE', numberColor: colors.green };
const COLLOCATION: Omit<NoticeStyle, 'label'> = { color: colors.primaryDeep, bg: '#EAF0F8', numberColor: colors.primary };
const REGISTER: Omit<NoticeStyle, 'label'> = { color: colors.inkSoft, bg: '#EDF1F6', numberColor: colors.register };
const IDIOM: Omit<NoticeStyle, 'label'> = { color: colors.terracotta, bg: '#F3E9E4', numberColor: colors.terracotta };

const NOTICE_LABELS: Record<NoticeCategory, string> = {
  connotation: 'コノテーション',
  collocation: 'コロケーション',
  register: 'レジスター',
  etymology: '語源',
  semantic_network: '意味のネットワーク',
  synonym_nuance: 'ニュアンス',
  grammar_pattern: '文法パターン',
  word_family: '語のファミリー',
  frequency: '頻度',
  common_error: '誤用注意',
  idiom: 'イディオム',
  phrasal_verb: '句動詞',
};

/** Categories share one of three visual groups (design.md 気づき番号色). */
const NOTICE_GROUP: Record<NoticeCategory, Omit<NoticeStyle, 'label'>> = {
  connotation: CONNOTATION,
  collocation: COLLOCATION,
  grammar_pattern: COLLOCATION,
  semantic_network: COLLOCATION,
  frequency: COLLOCATION,
  register: REGISTER,
  etymology: REGISTER,
  synonym_nuance: REGISTER,
  word_family: REGISTER,
  common_error: REGISTER,
  idiom: IDIOM,
  phrasal_verb: COLLOCATION,
};

/** Resolve the full chip + badge style for a notice category. */
export function noticeStyle(category: NoticeCategory): NoticeStyle {
  return { label: NOTICE_LABELS[category], ...NOTICE_GROUP[category] };
}

/**
 * Active "Spotlight Link" styling for a cue: a faint category FILL (background) for
 * underline-only / plain tokens, and a deep-variant RING (box-shadow) for tokens that
 * already own the background channel (collocation tint / keyword chip). Both are the cue's
 * own category color so the lit prose span matches its rail chip/badge — the color is the
 * mapping cue. Reuses the existing noticeStyle grouping; introduces no new base hues except
 * the deepened-terracotta token. The connotation ring uses greenDeep (not the green badge
 * color) so it stays off the Mastered mastery hue (#4C9A86).
 */
export interface CueHighlight {
  /** Faint category background, applied only where no background already exists. */
  fill: string;
  /** Deep category color for the inset ring (used on chips) and the lit-span outline. */
  ring: string;
}

/** Deep (active-ring) color per visual group, keyed by the shared group object. */
const CUE_RING_BY_GROUP = new Map<Omit<NoticeStyle, 'label'>, string>([
  [CONNOTATION, colors.greenDeep],
  [COLLOCATION, colors.primaryDeep],
  [REGISTER, colors.inkSoft],
  [IDIOM, colors.terracottaDeep],
]);

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function cueHighlight(category: NoticeCategory): CueHighlight {
  const group = NOTICE_GROUP[category];
  return {
    fill: hexToRgba(group.numberColor, 0.1),
    ring: CUE_RING_BY_GROUP.get(group) ?? colors.inkSoft,
  };
}

export const fonts = {
  ui: "'IBM Plex Sans','Noto Sans JP',sans-serif",
  num: "'IBM Plex Sans',sans-serif",
  serif: "'Newsreader',serif",
  serifJp: "'Newsreader','Noto Serif JP',serif",
  bodyJp: "'Noto Sans JP','IBM Plex Sans',sans-serif",
  mono: "'IBM Plex Sans',monospace",
} as const;

export const radius = {
  card: 8,
  control: 7,
  chip: 6,
  track: 3,
  full: '50%',
} as const;

export const shadow = {
  card: '0 6px 32px rgba(25,40,65,.10), 0 1px 3px rgba(25,40,65,.06)',
  play: '0 2px 8px rgba(61,108,176,.3)',
  dock: '0 -6px 24px rgba(25,40,65,.07)',
  thumb: '0 1px 3px rgba(0,0,0,.18)',
} as const;
