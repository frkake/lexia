/**
 * L4 — WCAG contrast utilities for the design tokens (D-8). Pure functions so `tokens.test.ts`
 * can assert that every text token clears WCAG 2.1 AA (4.5:1 for normal text) on the surfaces
 * it is actually used on, guarding against re-introducing low-contrast greys.
 */

/** sRGB 8-bit channel → linear light. */
function linearize(channel8: number): number {
  const s = channel8 / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a `#rrggbb` color (0 = black … 1 = white). */
export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio between two `#rrggbb` colors (1 … 21). Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.1 AA minimum contrast for normal-size text. */
export const AA_NORMAL_TEXT = 4.5;
/** WCAG 2.1 AA minimum contrast for large text (≥18pt, or ≥14pt bold). */
export const AA_LARGE_TEXT = 3;

/** Whether `fg` on `bg` clears AA (normal text by default). */
export function meetsAA(fg: string, bg: string, large = false): boolean {
  return contrastRatio(fg, bg) >= (large ? AA_LARGE_TEXT : AA_NORMAL_TEXT);
}
