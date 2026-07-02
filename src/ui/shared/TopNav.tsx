/**
 * L4 — TopNav: the PC header brand + primary destinations (design.md Reading/Dashboard
 * frames, 12.1). NavLink drives the active underline and sets aria-current for the
 * current route; routes never swap layout — the single tree adapts by width.
 */

import { NavLink } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { colors, fonts } from '../theme/tokens';

const DESTINATIONS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'ホーム', end: true },
  { to: '/library', label: '文章' },
  { to: '/review', label: '復習' },
  { to: '/wordbook', label: '単語帳' },
];

const linkStyle = (isActive: boolean): CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 14,
  textDecoration: 'none',
  color: isActive ? colors.ink : colors.muted,
  fontWeight: isActive ? 600 : 400,
  borderBottom: isActive ? `2px solid ${colors.primary}` : '2px solid transparent',
  paddingBottom: 4,
});

export function TopNav() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
      <span style={{ fontFamily: fonts.serif, fontSize: 23, fontWeight: 600, color: colors.ink }}>
        Lexia<span style={{ color: colors.primary }}>.</span>
      </span>
      <nav style={{ display: 'flex', gap: 26 }}>
        {DESTINATIONS.map((d) => (
          <NavLink key={d.to} to={d.to} end={d.end} style={({ isActive }) => linkStyle(isActive)}>
            {d.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
