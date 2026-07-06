// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { WordDetailCard } from './WordDetailCard';
import { playerStore } from '../../state/stores/playerStore';
import type { WordData } from '../../types/domain';

const full: WordData = {
  wordId: 'leverage',
  headword: 'leverage',
  ipa: '/ˈlevərɪdʒ/',
  pos: ['動詞', '名詞'],
  register: 'ビジネス',
  connotation: '中立',
  frequency: 4,
  audioUrl: 'https://cdn/leverage.mp3',
  illustrationUrl: 'data:image/png;base64,AAA',
  memoryTips: [{ kind: 'etymology', tipJa: 'lever（てこ）のイメージで覚える。' }],
  core: {
    meaningsJa: ['既にある資源・立場を活かして大きな成果を引き出すこと。'],
    examples: [{ en: 'We can leverage our network.', ja: '人脈を活かせる。' }],
    collocations: [
      { id: 'leverage-resources', pattern: 'leverage ＜資源・立場＞', type: 'V+N', slotExamples: ['resources', 'data', 'network'], glossJa: '資源を活かして成果を出す', l1Contrast: false },
    ],
    synonymNuances: ['use は一般的に「使う」。leverage は既にある資源を活かして成果を大きくする響き。'],
  },
  more: {
    etymology: {
      parts: [
        { form: 'lever', surfaceIn: 'lever', meaningJa: 'てこ' },
        { form: '-age', surfaceIn: 'age', meaningJa: '状態・作用' },
      ],
      bridgeJa: 'lever は「てこ」。小さな力で大きく動かす道具から、資源を活かして大きな成果を出す意味に広がった。',
      cognates: [{ word: 'elevate', noteJa: '持ち上げる' }],
    },
    semanticNetwork: [
      { word: 'use', relation: 'synonym', noteJa: 'より一般的で中立' },
      { word: 'exploit', relation: 'related', noteJa: '悪用の含みが出やすい' },
    ],
    idioms: [
      {
        expression: 'leverage the situation',
        meaningJa: '状況を有利に活かす',
        originJa: 'てこで状況を動かすイメージ → 手元の状況を梃子にして有利に運ぶ、という比喩。',
      },
    ],
    wordFamily: ['leverage', 'leveraged', 'leveraging'],
    metaphor: '「てこ」=小さな力で大きく動かす',
  },
};

const minimal: WordData = {
  wordId: 'erode',
  headword: 'erode',
  ipa: '/ɪˈroʊd/',
  pos: ['動詞'],
  register: '一般',
  connotation: '否定的',
  frequency: 2,
  core: { meaningsJa: ['少しずつ損なう。'], examples: [], collocations: [], synonymNuances: [] },
};

beforeEach(() => {
  act(() => playerStore.setState({ playWord: vi.fn() }));
});

describe('<WordDetailCard/>', () => {
  it('shows the header: headword, IPA, parts of speech, register, connotation, frequency, mastery', () => {
    const { getByText, getByTestId } = render(<WordDetailCard word={full} stage="Consolidating" />);
    expect(getByText('leverage')).toBeTruthy();
    expect(getByText('/ˈlevərɪdʒ/')).toBeTruthy();
    expect(getByText(/レジスター: ビジネス/)).toBeTruthy();
    expect(getByText(/コノテーション: 中立/)).toBeTruthy();
    expect(getByTestId('frequency').getAttribute('data-frequency')).toBe('4');
    expect(getByText(/習熟度: 定着/)).toBeTruthy();
  });

  // ── D-3: FSRS transparency (next review + progress to 定着) ───────────────────
  it('shows the next-review date and「定着まであと N 回」when scheduling is supplied', () => {
    const now = Date.UTC(2026, 6, 6, 3, 0, 0);
    const tomorrow = now + 24 * 60 * 60 * 1000;
    const { getByTestId, getByText } = render(
      <WordDetailCard word={full} stage="Learning" now={now} scheduling={{ dueAt: tomorrow, repsToConsolidate: 3 }} />,
    );
    const info = getByTestId('scheduling-info');
    expect(info.textContent).toContain('次回復習');
    expect(info.textContent).toContain('明日');
    expect(getByText(/定着まであと/)).toBeTruthy();
    expect(info.textContent).toContain('3');
  });

  it('shows「定着済み」instead of a remaining-count when already consolidated', () => {
    const now = Date.UTC(2026, 6, 6, 3, 0, 0);
    const { getByTestId } = render(
      <WordDetailCard word={full} stage="Consolidating" now={now} scheduling={{ dueAt: now, repsToConsolidate: 0 }} />,
    );
    expect(getByTestId('scheduling-info').textContent).toContain('定着済み');
  });

  it('omits the scheduling block entirely for a never-studied word (no scheduling prop)', () => {
    const { queryByTestId } = render(<WordDetailCard word={full} stage="New" />);
    expect(queryByTestId('scheduling-info')).toBeNull();
  });

  it('always shows core meaning, examples and collocations (8.2)', () => {
    const { getByText } = render(<WordDetailCard word={full} />);
    expect(getByText(/資源・立場を活かして/)).toBeTruthy();
    expect(getByText('We can leverage our network.')).toBeTruthy();
    expect(getByText('人脈を活かせる。')).toBeTruthy();
    // C-3: the head+slot pattern and its slot-example fillers render as a row.
    expect(getByText('leverage ＜資源・立場＞')).toBeTruthy();
    expect(getByText('resources')).toBeTruthy();
    expect(getByText('lever（てこ）のイメージで覚える。')).toBeTruthy();
  });

  it('renders a collocation as a slotted row with an L1-contrast badge when flagged (C-3)', () => {
    const contrast: WordData = {
      ...minimal,
      core: {
        ...minimal.core,
        collocations: [
          { id: 'strong-coffee', pattern: 'strong ＜coffee＞', type: 'Adj+N', slotExamples: ['coffee', 'tea'], glossJa: '濃いコーヒー（≠強い）', l1Contrast: true },
        ],
      },
    };
    const { getByText, getByTestId } = render(<WordDetailCard word={contrast} />);
    expect(getByText('strong ＜coffee＞')).toBeTruthy();
    expect(getByTestId('l1-contrast')).toBeTruthy();
  });

  it('shows structured idioms with their origin bridge (C-1)', () => {
    const { getByText, getByTestId, getAllByText } = render(<WordDetailCard word={full} />);
    fireEvent.click(getByText('イディオム・フレーズ'));
    // Expression appears in both the row summary and the card body — assert at least one.
    expect(getAllByText('leverage the situation').length).toBeGreaterThan(0);
    expect(getByTestId('idiom-origin')).toBeTruthy();
    expect(getByText(/てこで状況を動かすイメージ/)).toBeTruthy();
  });

  it('shows the etymology decomposition and bridge chain (C-2)', () => {
    const { getByText, getByTestId } = render(<WordDetailCard word={full} />);
    fireEvent.click(getByText('語源'));
    expect(getByTestId('etymology-bridge')).toBeTruthy();
    expect(getByText(/小さな力で大きく動かす道具/)).toBeTruthy();
  });

  it('auto-expands 語源 for a New/Learning word (C-2)', () => {
    const { getByTestId } = render(<WordDetailCard word={full} stage="Learning" />);
    expect(getByTestId('more-detail-語源')).toBeTruthy(); // open without a click
    expect(getByTestId('etymology-bridge')).toBeTruthy();
  });

  it('renders the semantic network grouped by relation and taps a neighbor open (C-2)', () => {
    const onOpenWord = vi.fn();
    const { getByText, getByTestId } = render(<WordDetailCard word={full} onOpenWord={onOpenWord} />);
    fireEvent.click(getByText('意味のネットワーク'));
    fireEvent.click(getByTestId('open-word-use'));
    expect(onOpenWord).toHaveBeenCalledWith('use');
  });

  it('renders the supplied illustration image', () => {
    const { getByAltText } = render(<WordDetailCard word={full} />);
    expect((getByAltText('leverage') as HTMLImageElement).src).toContain('data:image/png');
  });

  it('plays the pronunciation through the player store (7.6)', () => {
    const { getByLabelText } = render(<WordDetailCard word={full} />);
    fireEvent.click(getByLabelText('発音を再生'));
    expect(playerStore.getState().playWord).toHaveBeenCalledWith('https://cdn/leverage.mp3');
  });

  it('prefers an injected pronunciation URL over WordData.audioUrl', () => {
    const { getByLabelText } = render(<WordDetailCard word={full} audioUrl="https://tts/leverage.mp3" />);
    fireEvent.click(getByLabelText('発音を再生'));
    expect(playerStore.getState().playWord).toHaveBeenCalledWith('https://tts/leverage.mp3');
  });

  it('marks the word as unknown through the supplied handler', () => {
    const onMarkUnknown = vi.fn();
    const { getByTestId } = render(<WordDetailCard word={full} onMarkUnknown={onMarkUnknown} />);
    fireEvent.click(getByTestId('mark-unknown'));
    expect(onMarkUnknown).toHaveBeenCalledWith('leverage');
  });

  it('weaves the word into the next passage through the supplied handler (A-3-2)', () => {
    const onWeave = vi.fn();
    const { getByTestId } = render(<WordDetailCard word={full} onWeave={onWeave} />);
    fireEvent.click(getByTestId('weave-word'));
    expect(onWeave).toHaveBeenCalledWith('leverage');
  });

  it('hides the「次の文章に織り込む」button when no weave handler is supplied (A-3-2)', () => {
    const { container } = render(<WordDetailCard word={full} />);
    expect(container.querySelector('[data-testid="weave-word"]')).toBeNull();
  });

  it('declares the word known (「もう覚えた」) through the supplied handler when active (C-5d)', () => {
    const onMarkKnown = vi.fn();
    const { getByTestId, queryByTestId } = render(<WordDetailCard word={full} onMarkKnown={onMarkKnown} onRestore={vi.fn()} />);
    // While active it shows the mark-known action, not the restore action.
    expect(queryByTestId('restore-word')).toBeNull();
    fireEvent.click(getByTestId('mark-known'));
    expect(onMarkKnown).toHaveBeenCalledWith('leverage');
  });

  it('shows the restore action and「復習から除外中」when suspended, hiding mark-known/unknown (C-5d)', () => {
    const onRestore = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <WordDetailCard word={full} suspended onMarkUnknown={vi.fn()} onMarkKnown={vi.fn()} onRestore={onRestore} />,
    );
    expect(getByTestId('suspended-indicator')).toBeTruthy();
    expect(queryByTestId('mark-known')).toBeNull();
    expect(queryByTestId('mark-unknown')).toBeNull();
    fireEvent.click(getByTestId('restore-word'));
    expect(onRestore).toHaveBeenCalledWith('leverage');
  });

  it('collapses MORE items, expanding on demand (8.3/8.4)', () => {
    const { getByText, queryByTestId } = render(<WordDetailCard word={full} />);
    expect(queryByTestId('more-detail-語源')).toBeNull(); // detail hidden until expanded
    fireEvent.click(getByText('語源'));
    expect(queryByTestId('more-detail-語源')).not.toBeNull();
    expect(getByText(/小さな力で大きく動かす道具/)).toBeTruthy();
  });

  it('skips missing attributes without breaking when MORE is absent (8.5)', () => {
    const { getByText, queryByText } = render(<WordDetailCard word={minimal} />);
    expect(getByText('erode')).toBeTruthy(); // card still renders
    expect(getByText(/少しずつ損なう/)).toBeTruthy();
    expect(queryByText('語源')).toBeNull(); // no MORE rows
    expect(queryByText('例文 / Examples')).toBeNull(); // empty core sections omitted
  });

  it('tolerates partial cached MORE data with missing arrays', () => {
    const partial = {
      ...minimal,
      core: { meaningsJa: ['指導者'], examples: undefined, collocations: undefined, synonymNuances: undefined },
      more: {
        semanticNetwork: { synonyms: ['mentor'] },
        wordFamily: undefined,
        idioms: undefined,
        grammarPatterns: undefined,
        commonErrors: undefined,
      },
    } as unknown as WordData;
    const { getByText } = render(<WordDetailCard word={partial} />);
    expect(getByText('erode')).toBeTruthy();
    fireEvent.click(getByText('意味のネットワーク'));
    expect(getByText(/mentor/)).toBeTruthy();
  });

  it('renders a fully legacy-format cached row without crashing (C-1/2/3 back-compat)', () => {
    // A v1 cache row (pre-structuring): string collocations/idioms, prefix/root/suffix etymology,
    // five-array semantic network. The card lifts it in place so old caches never break.
    const legacy = {
      wordId: 'resilient',
      headword: 'resilient',
      ipa: '/rɪˈzɪliənt/',
      pos: ['adjective'],
      register: 'neutral',
      connotation: '肯定的',
      frequency: 4,
      core: {
        meaningsJa: ['回復力のある'],
        examples: [],
        collocations: ['remain resilient', 'a resilient system'],
        synonymNuances: ['tough より内面的'],
      },
      more: {
        etymology: { prefix: 're-', root: 'salire（跳ねる）', noteJa: '跳ね返るイメージから回復する力へ。' },
        semanticNetwork: { synonyms: ['tough'], antonyms: ['fragile'], hypernyms: [], hyponyms: [], related: ['adaptable'] },
        idioms: ['bounce back'],
        wordFamily: ['resilience'],
      },
    } as unknown as WordData;
    const { getByText, getByTestId, getAllByText } = render(<WordDetailCard word={legacy} />);
    expect(getByText('resilient')).toBeTruthy();
    // Legacy string collocation is lifted to a row (pattern = the raw string), not a bare chip.
    expect(getByTestId('collocation-remain-resilient')).toBeTruthy();
    expect(getByText('remain resilient')).toBeTruthy();
    // Legacy prefix/root etymology lifts into the breakdown; noteJa carries into the bridge.
    fireEvent.click(getByText('語源'));
    expect(getByText(/跳ね返るイメージから回復する力へ/)).toBeTruthy();
    // Legacy string idiom lifts into an idiom card (no origin yet, but no crash).
    fireEvent.click(getByText('イディオム・フレーズ'));
    expect(getAllByText('bounce back').length).toBeGreaterThan(0);
  });

  it('disables pronunciation when no audio is supplied', () => {
    const { getByLabelText } = render(<WordDetailCard word={minimal} />);
    expect((getByLabelText('発音を再生') as HTMLButtonElement).disabled).toBe(true);
  });

  it('closes via the provided handler', () => {
    const onClose = vi.fn();
    const { getByLabelText } = render(<WordDetailCard word={full} onClose={onClose} />);
    fireEvent.click(getByLabelText('閉じる'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
