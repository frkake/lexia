/**
 * L4 — Legend: the reading-screen key that names what each annotation means
 * (design.md Reading frame, 4.4). Underline swatches mirror the mastery-density
 * encoding; the collocation swatch and the circled "気づき" number complete the set.
 */

import { annotationEncoding, colors, fonts } from '../theme/tokens';

const swatch = (underlineStyle: 'solid' | 'dotted', color: string) => (
  <span style={{ width: 18, borderBottom: `2px ${underlineStyle} ${color}` }} />
);

const item = (sample: React.ReactNode, label: string) => (
  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    {sample}
    {label}
  </span>
);

export function Legend() {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '13px 18px',
        marginTop: 34,
        paddingTop: 20,
        borderTop: `1px solid ${colors.borderCard}`,
        fontFamily: fonts.ui,
        fontSize: 12,
        color: colors.muted,
      }}
    >
      {item(swatch('solid', annotationEncoding.new.color), '新出')}
      {item(swatch('solid', annotationEncoding.review.color), '学習中')}
      {item(swatch('dotted', annotationEncoding.known.color), '定着・再登場')}
      <span style={{ width: 1, height: 14, background: colors.borderControl }} />
      {item(
        <span style={{ width: 18, height: 12, background: colors.surfaceCollocation, borderRadius: 3 }} />,
        'コロケーション',
      )}
      {item(
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 15,
            height: 15,
            borderRadius: '50%',
            background: colors.primary,
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
          }}
        >
          1
        </span>,
        '気づき（右に解説）',
      )}
    </div>
  );
}
