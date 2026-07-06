import { describe, it, expect } from 'vitest';
import {
  collocationSlug,
  structureCollocations,
  structureEtymology,
  structureIdioms,
  structureMore,
  structureSemanticNetwork,
  structuredWordData,
} from './structuredWordData';
import type { WordData } from '../../types/domain';

describe('collocationSlug', () => {
  it('kebab-cases a phrase and drops non-alphanumerics', () => {
    expect(collocationSlug('remain resilient')).toBe('remain-resilient');
    expect(collocationSlug('accept ＜提案・招待＞')).toBe('accept');
    expect(collocationSlug('N + of + N')).toBe('n-of-n');
  });

  it('never returns an empty id', () => {
    expect(collocationSlug('＜＞')).toBe('collocation');
  });
});

describe('structureCollocations', () => {
  it('lifts legacy plain strings into structured entries (D4-compatible slug id)', () => {
    expect(structureCollocations(['remain resilient'])).toEqual([
      { id: 'remain-resilient', pattern: 'remain resilient', type: 'other', slotExamples: [], glossJa: '', l1Contrast: false },
    ]);
  });

  it('validates and prunes structured entries idempotently', () => {
    const input = [
      { id: 'accept-proposal', pattern: 'accept ＜提案＞', type: 'V+N', slotExamples: ['offer', 'proposal'], glossJa: '受け入れる', exampleEn: 'accept the offer', l1Contrast: true },
      { pattern: '', type: 'V+N', slotExamples: [], glossJa: '', l1Contrast: false }, // empty pattern dropped
      { pattern: 'strong ＜coffee＞', type: 'weird', slotExamples: [1, 'tea'], glossJa: '', l1Contrast: false }, // bad type→other, non-string filler dropped
    ];
    const out = structureCollocations(input);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ id: 'accept-proposal', pattern: 'accept ＜提案＞', type: 'V+N', slotExamples: ['offer', 'proposal'], glossJa: '受け入れる', exampleEn: 'accept the offer', l1Contrast: true });
    expect(out[1]).toEqual({ id: 'strong-coffee', pattern: 'strong ＜coffee＞', type: 'other', slotExamples: ['tea'], glossJa: '', l1Contrast: false });
  });

  it('returns [] for non-array input', () => {
    expect(structureCollocations(undefined)).toEqual([]);
  });
});

describe('structureIdioms', () => {
  it('lifts legacy strings into IdiomEntry with blank meaning/origin', () => {
    expect(structureIdioms(['break the ice'])).toEqual([{ expression: 'break the ice', meaningJa: '', originJa: '' }]);
  });

  it('keeps structured entries and drops ones without an expression', () => {
    const out = structureIdioms([
      { expression: 'break the ice', meaningJa: '緊張をほぐす', originJa: '氷を割る → 場をほぐす', exampleEn: 'Break the ice with a joke.' },
      { meaningJa: 'no expression' },
    ]);
    expect(out).toEqual([
      { expression: 'break the ice', meaningJa: '緊張をほぐす', originJa: '氷を割る → 場をほぐす', exampleEn: 'Break the ice with a joke.' },
    ]);
  });
});

describe('structureEtymology', () => {
  it('lifts legacy prefix/root/suffix + noteJa into parts + bridgeJa', () => {
    expect(structureEtymology({ prefix: 're-', root: 'salire', suffix: null, noteJa: '跳ね返る → 回復力' })).toEqual({
      parts: [
        { form: 're-', surfaceIn: null, meaningJa: '' },
        { form: 'salire', surfaceIn: null, meaningJa: '' },
      ],
      bridgeJa: '跳ね返る → 回復力',
      cognates: [],
    });
  });

  it('keeps structured EtymologyV2 and prunes empty parts/cognates', () => {
    const out = structureEtymology({
      parts: [{ form: 're-', surfaceIn: 're', meaningJa: '再び' }, { form: '', surfaceIn: null, meaningJa: '' }],
      bridgeJa: '再び跳ぶ',
      cognates: [{ word: 'result', noteJa: '結果' }, { noteJa: 'no word' }],
      sourceJa: 'ラテン語 salire',
    });
    expect(out).toEqual({
      parts: [{ form: 're-', surfaceIn: 're', meaningJa: '再び' }],
      bridgeJa: '再び跳ぶ',
      cognates: [{ word: 'result', noteJa: '結果' }],
      sourceJa: 'ラテン語 salire',
    });
  });

  it('returns undefined when nothing meaningful remains', () => {
    expect(structureEtymology({ prefix: null, root: null, suffix: null, noteJa: '' })).toBeUndefined();
    expect(structureEtymology(null)).toBeUndefined();
  });
});

describe('structureSemanticNetwork', () => {
  it('flattens the legacy five-array object into relation-tagged neighbors', () => {
    expect(structureSemanticNetwork({ synonyms: ['tough'], antonyms: ['fragile'], hypernyms: [], hyponyms: [], related: ['adaptable'] })).toEqual([
      { word: 'tough', relation: 'synonym', noteJa: '' },
      { word: 'fragile', relation: 'antonym', noteJa: '' },
      { word: 'adaptable', relation: 'related', noteJa: '' },
    ]);
  });

  it('keeps a structured flat array and drops invalid relations / missing words', () => {
    const out = structureSemanticNetwork([
      { word: 'tough', relation: 'synonym', noteJa: 'より口語的' },
      { word: 'x', relation: 'nonsense', noteJa: '' },
      { relation: 'antonym', noteJa: '' },
    ]);
    expect(out).toEqual([{ word: 'tough', relation: 'synonym', noteJa: 'より口語的' }]);
  });
});

describe('structureMore', () => {
  it('prunes fields that reduce to empty', () => {
    expect(
      structureMore({
        etymology: { prefix: null, root: null, suffix: null, noteJa: '' },
        semanticNetwork: { synonyms: [], antonyms: [], hypernyms: [], hyponyms: [], related: [] },
        idioms: [],
        wordFamily: ['resilience'],
      }),
    ).toEqual({ wordFamily: ['resilience'] });
  });

  it('returns undefined when everything prunes away', () => {
    expect(structureMore({ idioms: [], wordFamily: [] })).toBeUndefined();
  });
});

describe('structuredWordData', () => {
  const legacy = {
    wordId: 'resilient',
    headword: 'resilient',
    ipa: '',
    pos: ['adj'],
    register: 'neutral',
    connotation: '肯定的',
    frequency: 4,
    memoryTips: [{ kind: 'image', tipJa: '跳ね返るイメージ' }],
    core: { meaningsJa: ['回復力のある'], examples: [], collocations: ['remain resilient'], synonymNuances: ['tough より内面的'] },
    more: {
      etymology: { prefix: 're-', root: 'salire', noteJa: '跳ね返る → 回復力' },
      semanticNetwork: { synonyms: ['tough'], antonyms: ['fragile'], hypernyms: [], hyponyms: [], related: [] },
      idioms: ['bounce back'],
    },
  } as unknown as WordData;

  it('lifts a whole legacy WordData while leaving header/memoryTips untouched', () => {
    const out = structuredWordData(legacy);
    expect(out.core.collocations).toEqual([
      { id: 'remain-resilient', pattern: 'remain resilient', type: 'other', slotExamples: [], glossJa: '', l1Contrast: false },
    ]);
    expect(out.more?.etymology?.bridgeJa).toBe('跳ね返る → 回復力');
    expect(out.more?.semanticNetwork).toEqual([
      { word: 'tough', relation: 'synonym', noteJa: '' },
      { word: 'fragile', relation: 'antonym', noteJa: '' },
    ]);
    expect(out.more?.idioms).toEqual([{ expression: 'bounce back', meaningJa: '', originJa: '' }]);
    expect(out.memoryTips).toBe(legacy.memoryTips);
  });

  it('is idempotent: re-structuring already-structured data is a no-op', () => {
    const once = structuredWordData(legacy);
    const twice = structuredWordData(once);
    expect(twice.core.collocations).toEqual(once.core.collocations);
    expect(twice.more).toEqual(once.more);
  });

  it('drops `more` entirely when it prunes to nothing', () => {
    const bare = { ...legacy, more: { idioms: [] } } as unknown as WordData;
    expect(structuredWordData(bare).more).toBeUndefined();
  });
});
