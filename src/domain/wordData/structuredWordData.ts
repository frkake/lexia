/**
 * L1 — pure, idempotent structuring of a WordData's rich attributes (C-1/C-2/C-3).
 *
 * WordData's collocations / idioms / etymology / semanticNetwork became structured types. Two entry
 * points must accept BOTH the new structured shape and the legacy shape and always emit the new one:
 *   - the server proxy's `normalizeWordData` (fresh LLM output — usually new, but defensively lifted),
 *   - the client cache's `liftWordData` (v1 rows persisted in Dexie under the legacy shape).
 * Both delegate here so the old→new conversion lives in exactly one place. Every function is
 * shape-detecting and idempotent: passing already-structured data back through is a no-op (empties are
 * pruned). No I/O — safe to import from `server/`.
 */

import type {
  CollocationEntry,
  EtymologyPart,
  EtymologyV2,
  IdiomEntry,
  SemanticNeighbor,
  SemanticRelation,
  WordData,
} from '../../types/domain';

const COLLOCATION_TYPES = new Set(['V+N', 'Adj+N', 'N+of+N', 'V+Prep', 'Adv+V', 'other']);
const SEMANTIC_RELATIONS: SemanticRelation[] = ['synonym', 'antonym', 'hypernym', 'hyponym', 'related'];

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
}

/** kebab-case slug used as a collocation's stable id when lifting a legacy plain-string collocation. */
export function collocationSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'collocation';
}

/**
 * Normalize `core.collocations` to `CollocationEntry[]`. Legacy plain strings become
 * `{ id: slug, pattern: string, type: 'other', slotExamples: [], glossJa: '', l1Contrast: false }`
 * (D4: the slug id + the raw string both resolve a span). Structured entries are validated/pruned.
 */
export function structureCollocations(value: unknown): CollocationEntry[] {
  if (!Array.isArray(value)) return [];
  const out: CollocationEntry[] = [];
  for (const raw of value) {
    if (typeof raw === 'string') {
      const s = raw.trim();
      if (!s) continue;
      out.push({ id: collocationSlug(s), pattern: s, type: 'other', slotExamples: [], glossJa: '', l1Contrast: false });
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    // Legacy word data occasionally carried the surface under text/surface/phrase/collocation.
    const pattern = text(r.pattern) ?? text(r.text) ?? text(r.surface) ?? text(r.phrase) ?? text(r.collocation);
    if (!pattern) continue;
    const rawType = typeof r.type === 'string' ? r.type : '';
    const entry: CollocationEntry = {
      id: text(r.id) ?? collocationSlug(pattern),
      pattern,
      type: COLLOCATION_TYPES.has(rawType) ? (rawType as CollocationEntry['type']) : 'other',
      slotExamples: strings(r.slotExamples),
      glossJa: text(r.glossJa) ?? '',
      l1Contrast: r.l1Contrast === true,
    };
    const exampleEn = text(r.exampleEn);
    if (exampleEn) entry.exampleEn = exampleEn;
    out.push(entry);
  }
  return out;
}

/**
 * Normalize `more.idioms` to `IdiomEntry[]`. Legacy plain strings become
 * `{ expression, meaningJa: '', originJa: '' }`; structured entries are validated/pruned.
 */
export function structureIdioms(value: unknown): IdiomEntry[] {
  if (!Array.isArray(value)) return [];
  const out: IdiomEntry[] = [];
  for (const raw of value) {
    if (typeof raw === 'string') {
      const s = raw.trim();
      if (!s) continue;
      out.push({ expression: s, meaningJa: '', originJa: '' });
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const expression = text(r.expression);
    if (!expression) continue;
    const entry: IdiomEntry = {
      expression,
      meaningJa: text(r.meaningJa) ?? '',
      originJa: text(r.originJa) ?? '',
    };
    const exampleEn = text(r.exampleEn);
    if (exampleEn) entry.exampleEn = exampleEn;
    const exampleJa = text(r.exampleJa);
    if (exampleJa) entry.exampleJa = exampleJa;
    out.push(entry);
  }
  return out;
}

/**
 * Normalize `more.etymology` to `EtymologyV2` (or undefined when nothing meaningful remains). The
 * legacy `{ prefix?, root?, suffix?, noteJa? }` shape becomes ordered `parts` (surfaceIn=null,
 * meaningJa='') with `noteJa` carried into `bridgeJa`. Structured input is validated/pruned.
 */
export function structureEtymology(value: unknown): EtymologyV2 | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const r = value as Record<string, unknown>;
  const isStructured = Array.isArray(r.parts) || typeof r.bridgeJa === 'string' || Array.isArray(r.cognates);

  let parts: EtymologyPart[];
  let bridgeJa: string;
  let sourceJa: string | undefined;
  let cognates: EtymologyV2['cognates'];

  if (isStructured) {
    parts = Array.isArray(r.parts)
      ? r.parts
          .map((p): EtymologyPart | null => {
            if (!p || typeof p !== 'object') return null;
            const pr = p as Record<string, unknown>;
            const form = text(pr.form);
            if (!form) return null;
            return { form, surfaceIn: text(pr.surfaceIn) ?? null, meaningJa: text(pr.meaningJa) ?? '' };
          })
          .filter((p): p is EtymologyPart => p !== null)
      : [];
    bridgeJa = text(r.bridgeJa) ?? '';
    sourceJa = text(r.sourceJa);
    cognates = Array.isArray(r.cognates)
      ? r.cognates
          .map((c): EtymologyV2['cognates'][number] | null => {
            if (!c || typeof c !== 'object') return null;
            const cr = c as Record<string, unknown>;
            const word = text(cr.word);
            if (!word) return null;
            return { word, noteJa: text(cr.noteJa) ?? '' };
          })
          .filter((c): c is EtymologyV2['cognates'][number] => c !== null)
      : [];
  } else {
    // Legacy { prefix?, root?, suffix?, noteJa? } → ordered parts + noteJa carried into bridgeJa.
    parts = [text(r.prefix), text(r.root), text(r.suffix)]
      .filter((f): f is string => !!f)
      .map((form) => ({ form, surfaceIn: null, meaningJa: '' }));
    bridgeJa = text(r.noteJa) ?? '';
    sourceJa = undefined;
    cognates = [];
  }

  if (parts.length === 0 && !bridgeJa) return undefined;
  const out: EtymologyV2 = { parts, bridgeJa, cognates };
  if (sourceJa) out.sourceJa = sourceJa;
  return out;
}

/**
 * Normalize `more.semanticNetwork` to `SemanticNeighbor[]`. The legacy five-array object
 * `{ synonyms, antonyms, hypernyms, hyponyms, related }` is flattened to relation-tagged neighbors
 * (noteJa=''); a structured flat array is validated/pruned.
 */
export function structureSemanticNetwork(value: unknown): SemanticNeighbor[] {
  if (Array.isArray(value)) {
    const out: SemanticNeighbor[] = [];
    for (const raw of value) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const word = text(r.word);
      const relation = r.relation;
      if (!word || typeof relation !== 'string' || !SEMANTIC_RELATIONS.includes(relation as SemanticRelation)) continue;
      out.push({ word, relation: relation as SemanticRelation, noteJa: text(r.noteJa) ?? '' });
    }
    return out;
  }
  if (!value || typeof value !== 'object') return [];
  const r = value as Record<string, unknown>;
  const groups: [SemanticRelation, unknown][] = [
    ['synonym', r.synonyms],
    ['antonym', r.antonyms],
    ['hypernym', r.hypernyms],
    ['hyponym', r.hyponyms],
    ['related', r.related],
  ];
  const out: SemanticNeighbor[] = [];
  for (const [relation, arr] of groups) {
    for (const word of strings(arr)) out.push({ word, relation, noteJa: '' });
  }
  return out;
}

/** Build the structured, empty-pruned `more` object (undefined when nothing meaningful remains). */
export function structureMore(value: unknown): WordData['more'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const r = value as Record<string, unknown>;
  const more: NonNullable<WordData['more']> = {};
  const etymology = structureEtymology(r.etymology);
  if (etymology) more.etymology = etymology;
  const semanticNetwork = structureSemanticNetwork(r.semanticNetwork);
  if (semanticNetwork.length > 0) more.semanticNetwork = semanticNetwork;
  const wordFamily = strings(r.wordFamily);
  if (wordFamily.length > 0) more.wordFamily = wordFamily;
  const idioms = structureIdioms(r.idioms);
  if (idioms.length > 0) more.idioms = idioms;
  const grammarPatterns = strings(r.grammarPatterns);
  if (grammarPatterns.length > 0) more.grammarPatterns = grammarPatterns;
  const metaphor = text(r.metaphor);
  if (metaphor) more.metaphor = metaphor;
  const commonErrors = strings(r.commonErrors);
  if (commonErrors.length > 0) more.commonErrors = commonErrors;
  return Object.keys(more).length > 0 ? more : undefined;
}

/**
 * Return a WordData whose rich attributes are the current structured shape, lifting any legacy fields
 * (idioms/etymology/semanticNetwork/collocations) it still carries. Idempotent and side-effect free;
 * `memoryTips`, header fields, etc. are passed through untouched. `more` is dropped when it prunes to
 * nothing so the「empty ⇒ absent」grounding rule stays honest.
 */
export function structuredWordData(data: WordData): WordData {
  const out: WordData = { ...data };
  if (out.core) {
    out.core = { ...out.core, collocations: structureCollocations((out.core as { collocations?: unknown }).collocations) };
  }
  const more = structureMore((data as { more?: unknown }).more);
  if (more) out.more = more;
  else delete out.more;
  return out;
}
