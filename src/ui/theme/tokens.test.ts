import { describe, it, expect } from 'vitest';
import {
  colors,
  masteryColors,
  annotationEncoding,
  noticeStyle,
  cueHighlight,
  fonts,
  radius,
} from './tokens';

/**
 * These assertions pin the design-token single source of truth (design.md
 * "Design Tokens"). The mock (`英単語学習サイト.dc.html`) is the visual basis;
 * these are the machine-extracted values the UI and visual-regression tests share.
 */
describe('design tokens', () => {
  it('exposes the brand primary and ink colors', () => {
    expect(colors.primary).toBe('#3D6CB0');
    expect(colors.primaryDeep).toBe('#2D518C');
    expect(colors.ink).toBe('#1E2630');
    expect(colors.body).toBe('#27313D');
    expect(colors.surfacePage).toBe('#F6F8FA');
    expect(colors.surfaceCollocation).toBe('#E4EDF8');
    expect(colors.highlight).toBe('#DCE8F6');
  });

  it('maps the four mastery stages to their semantic colors', () => {
    expect(masteryColors.New).toBe('#C4CCD6');
    expect(masteryColors.Learning).toBe('#8FB0DA');
    expect(masteryColors.Consolidating).toBe('#4C7BC0');
    expect(masteryColors.Mastered).toBe('#4C9A86');
  });

  it('encodes passage annotations by mastery density', () => {
    // 新出: solid underline #4C7BC0
    expect(annotationEncoding.new).toEqual({ underlineStyle: 'solid', color: '#4C7BC0' });
    // 学習中: solid underline #8FB0DA
    expect(annotationEncoding.review).toEqual({ underlineStyle: 'solid', color: '#8FB0DA' });
    // 定着・再登場: dotted underline #C4CCD6
    expect(annotationEncoding.known).toEqual({ underlineStyle: 'dotted', color: '#C4CCD6' });
  });

  it('styles the three documented notice categories with chip + number colors', () => {
    expect(noticeStyle('connotation')).toMatchObject({
      label: 'コノテーション',
      color: '#3E8C79',
      bg: '#E6F2EE',
      numberColor: '#4C9A86',
    });
    expect(noticeStyle('collocation')).toMatchObject({
      label: 'コロケーション',
      color: '#2D518C',
      bg: '#EAF0F8',
      numberColor: '#3D6CB0',
    });
    expect(noticeStyle('register')).toMatchObject({
      label: 'レジスター',
      color: '#5A6675',
      bg: '#EDF1F6',
      numberColor: '#6B7686',
    });
  });

  it('groups grammar cues with the blue (collocation) number color', () => {
    expect(noticeStyle('grammar_pattern').numberColor).toBe('#3D6CB0');
  });

  it('styles idiom with the terracotta group and phrasal_verb with the blue group', () => {
    expect(noticeStyle('idiom')).toMatchObject({ label: 'イディオム', color: '#C07A63', numberColor: '#C07A63' });
    expect(noticeStyle('phrasal_verb')).toMatchObject({ label: '句動詞', numberColor: '#3D6CB0' });
  });

  it('returns a defined style for every notice category', () => {
    const categories = [
      'connotation',
      'collocation',
      'register',
      'etymology',
      'semantic_network',
      'synonym_nuance',
      'grammar_pattern',
      'word_family',
      'frequency',
      'common_error',
      'idiom',
      'phrasal_verb',
    ] as const;
    for (const c of categories) {
      const s = noticeStyle(c);
      expect(typeof s.label).toBe('string');
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('provides the documented font stacks and radii', () => {
    expect(fonts.serif).toContain('Newsreader');
    expect(fonts.serifJp).toContain('Noto Serif JP');
    expect(fonts.bodyJp).toContain('Noto Sans JP');
    expect(radius.card).toBe(8);
  });
});

describe('cueHighlight (Spotlight Link active styling)', () => {
  it('connotation: faint green fill + a deep-green ring kept off the Mastered hue', () => {
    const h = cueHighlight('connotation');
    expect(h.fill).toBe('rgba(76, 154, 134, 0.1)'); // green #4C9A86 @ 0.10
    expect(h.ring).toBe('#3E8C79'); // greenDeep
    // must NOT collide with the Mastered mastery color (#4C9A86)
    expect(h.ring).not.toBe(masteryColors.Mastered);
  });

  it('collocation group rings in the deep-blue family', () => {
    expect(cueHighlight('collocation').ring).toBe('#2D518C'); // primaryDeep
    expect(cueHighlight('grammar_pattern').ring).toBe('#2D518C');
    expect(cueHighlight('phrasal_verb').ring).toBe('#2D518C');
    expect(cueHighlight('collocation').fill).toBe('rgba(61, 108, 176, 0.1)');
  });

  it('register group rings in the gray family', () => {
    expect(cueHighlight('register').ring).toBe('#5A6675'); // inkSoft
    expect(cueHighlight('etymology').ring).toBe('#5A6675');
  });

  it('idiom rings in the deepened terracotta token', () => {
    expect(colors.terracottaDeep).toBe('#A65A41');
    expect(cueHighlight('idiom').ring).toBe('#A65A41');
    expect(cueHighlight('idiom').fill).toBe('rgba(192, 122, 99, 0.1)');
  });
});
