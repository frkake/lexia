/**
 * L2 — CefrDictionary (B-4): the production CEFR band lookup that revives the passage
 * vocabulary-profile gate. `PassageValidator` counts a token as "known" only when this
 * returns a band, so a passage generated far above the requested level is flagged
 * `cefr_out_of_band` and repaired (Hu & Nation 98%-coverage principle).
 *
 * Data: `cefr-bands.json` — an original, hand-curated frequency-tiered lemma→band list
 * dedicated to the public domain (CC0). Provenance / licensing / regeneration are documented
 * in `./README.md` (kept out of code comments, next to the asset). The five app bands
 * (A2 B1 B2 C1 C2) fold true A1 into A2.
 *
 * Lookup is lemma-tolerant: the passage carries surface tokens ("negotiated", "terms"), so we
 * try the token as-is and then a short ordered list of regular de-inflections, returning the band
 * of the first candidate present in the list. Anything still unmatched (proper nouns, irregulars,
 * rare derivations) resolves to `undefined`, which the validator deliberately skips — the same
 * tolerant "unknown ⇒ don't count it" behaviour the gate has always had.
 */

import bandsAsset from './cefr-bands.json';
import type { Cefr } from '../../types/domain';

/** Shape of the generated asset (see scripts/gen-cefr-bands.mjs). */
interface CefrBandsAsset {
  bands: Record<Cefr, string[]>;
}

const CONSONANT = 'bcdfghjklmnpqrstvwxyz';

/**
 * Ordered de-inflection candidates for a lowercased word. The word itself is yielded first, so any
 * lemma present verbatim always wins over a stripped guess (protects `offer`, `water`, `member`,
 * etc. from being mistaken for `off`/`wat`/`memb`). Candidates cover regular plural/3sg, past,
 * gerund, comparative/superlative, adverbial `-ly`, the silent-`e` and doubled-consonant cases.
 */
function* lemmaCandidates(w: string): Generator<string> {
  yield w;

  // Possessive.
  if (w.endsWith("'s") || w.endsWith('’s')) yield w.slice(0, -2);

  // Plural / 3rd-person singular.
  if (w.endsWith('ies') && w.length > 4) yield `${w.slice(0, -3)}y`; // studies → study
  if (w.endsWith('es') && w.length > 3) yield w.slice(0, -2); // boxes → box
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) yield w.slice(0, -1); // terms → term

  // Past tense / participle.
  if (w.endsWith('ied') && w.length > 4) yield `${w.slice(0, -3)}y`; // studied → study
  if (w.endsWith('ed') && w.length > 3) {
    yield w.slice(0, -2); // worked → work
    yield w.slice(0, -1); // negotiated → negotiate (silent e)
  }

  // Gerund / present participle.
  if (w.endsWith('ing') && w.length > 4) {
    yield w.slice(0, -3); // working → work
    yield `${w.slice(0, -3)}e`; // negotiating → negotiate (silent e)
  }

  // Comparative / superlative.
  if (w.endsWith('est') && w.length > 4) {
    yield w.slice(0, -3); // fastest → fast
    yield `${w.slice(0, -3)}e`; // largest → large
  }
  if (w.endsWith('er') && w.length > 3) {
    yield w.slice(0, -2); // faster → fast
    yield w.slice(0, -1); // larger → large
  }

  // Adverb.
  if (w.endsWith('ly') && w.length > 4) {
    yield w.slice(0, -2); // quickly → quick
    yield `${w.slice(0, -2)}e`; // gently is irregular; harmless extra candidate
  }

  // Doubled final consonant before a regular ending (running → run, bigger → big, hottest → hot).
  const doubled = w.match(/^(.*?)([a-z])\2(?:ing|ed|er|est)$/);
  if (doubled && CONSONANT.includes(doubled[2]!)) yield `${doubled[1]}${doubled[2]}`;
}

export interface CefrDictionary {
  /** Band for a (surface) token, or undefined when unknown. Case-insensitive. */
  lookup(token: string): Cefr | undefined;
}

/**
 * Build the production CEFR lookup. The asset is grouped by band; we flatten it into one
 * lemma→band map at construction (built once per container). Returned as a bare function so it
 * drops straight into the `cefrOf` seam used by the validator and the suggestion service.
 */
export function createCefrDictionary(): (token: string) => Cefr | undefined {
  const asset = bandsAsset as unknown as CefrBandsAsset;
  const map = new Map<string, Cefr>();
  // Iterate low→high so a lower band wins if a word were duplicated (the generator already
  // de-dupes, but this keeps the invariant local to the runtime too).
  for (const band of ['A2', 'B1', 'B2', 'C1', 'C2'] as const) {
    for (const word of asset.bands[band] ?? []) {
      if (!map.has(word)) map.set(word, band);
    }
  }

  return (token: string): Cefr | undefined => {
    const w = token.toLowerCase();
    for (const candidate of lemmaCandidates(w)) {
      const band = map.get(candidate);
      if (band) return band;
    }
    return undefined;
  };
}
