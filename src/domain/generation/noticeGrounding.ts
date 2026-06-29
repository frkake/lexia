/**
 * Single source of truth for grounding a NoticeCue against a word's supplied attributes,
 * shared by the client-side PassageValidator and the server proxy (which drops ungrounded
 * cues before they can fail validation). Grounding is keyed on the cue's CATEGORY — not on
 * the exact `sourceAttribute` string the model wrote — because models are inconsistent about
 * the `more.` prefix (e.g. they cite `commonErrors` instead of `more.commonErrors`).
 */

import type { NoticeCategory } from '../../types/domain';

/** Attribute keys (dotted paths into WordData) each cue category may legitimately cite. */
export const CATEGORY_ATTRIBUTES: Record<NoticeCategory, string[]> = {
  connotation: ['connotation'],
  collocation: ['core.collocations', 'collocations'],
  register: ['register'],
  etymology: ['more.etymology', 'etymology'],
  semantic_network: ['more.semanticNetwork', 'semanticNetwork'],
  synonym_nuance: ['core.synonymNuances', 'synonymNuances'],
  grammar_pattern: ['more.grammarPatterns', 'grammarPatterns'],
  word_family: ['more.wordFamily', 'wordFamily'],
  frequency: ['frequency'],
  common_error: ['more.commonErrors', 'commonErrors'],
  // Asserted directly by the exhaustive annotation pass (location-grounded), never attribute-grounded.
  idiom: [],
  phrasal_verb: [],
};

/** Resolve a dotted path and report whether it holds a non-empty value. */
export function hasAttribute(attributes: Record<string, unknown> | undefined, path: string): boolean {
  if (!attributes) return false;
  let cur: unknown = attributes;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(key in (cur as object))) return false;
    cur = (cur as Record<string, unknown>)[key];
  }
  if (cur === undefined || cur === null) return false;
  if (Array.isArray(cur)) return cur.length > 0;
  if (typeof cur === 'string') return cur.trim().length > 0;
  if (typeof cur === 'object') return Object.keys(cur as object).length > 0;
  return true; // numbers, booleans
}

/** A cue is grounded when ANY canonical attribute for its category is present + non-empty. */
export function isCueGrounded(category: NoticeCategory, attributes: Record<string, unknown> | undefined): boolean {
  return (CATEGORY_ATTRIBUTES[category] ?? []).some((path) => hasAttribute(attributes, path));
}
