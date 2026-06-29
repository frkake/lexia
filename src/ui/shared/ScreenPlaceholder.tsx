/**
 * L4 — ScreenPlaceholder: temporary route content for screens delivered in later tasks
 * (Dashboard 9.3, Review 9.2, Setup 9.1, Wordbook 9.4). Replaced as each screen lands.
 */

import { colors, fonts } from '../theme/tokens';

export function ScreenPlaceholder({ title }: { title: string }) {
  return (
    <div style={{ padding: '46px 60px', fontFamily: fonts.serifJp, fontSize: 27, color: colors.muted }}>
      {title}
    </div>
  );
}
