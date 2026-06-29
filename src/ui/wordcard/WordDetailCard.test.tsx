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
  core: {
    meaningsJa: ['既にある資源・立場を活かして大きな成果を引き出すこと。'],
    examples: [{ en: 'We can leverage our network.', ja: '人脈を活かせる。' }],
    collocations: ['leverage resources', 'leverage data'],
    synonymNuances: ['use — 中立で一般的'],
  },
  more: {
    etymology: { root: 'lever（てこ）', suffix: '-age' },
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

  it('always shows core meaning, examples and collocations (8.2)', () => {
    const { getByText } = render(<WordDetailCard word={full} />);
    expect(getByText(/資源・立場を活かして/)).toBeTruthy();
    expect(getByText('We can leverage our network.')).toBeTruthy();
    expect(getByText('人脈を活かせる。')).toBeTruthy();
    expect(getByText('leverage resources')).toBeTruthy();
  });

  it('plays the pronunciation through the player store (7.6)', () => {
    const { getByLabelText } = render(<WordDetailCard word={full} />);
    fireEvent.click(getByLabelText('発音を再生'));
    expect(playerStore.getState().playWord).toHaveBeenCalledWith('https://cdn/leverage.mp3');
  });

  it('collapses MORE items, expanding on demand (8.3/8.4)', () => {
    const { getByText, queryByTestId } = render(<WordDetailCard word={full} />);
    expect(queryByTestId('more-detail-語源')).toBeNull(); // detail hidden until expanded
    fireEvent.click(getByText('語源'));
    expect(queryByTestId('more-detail-語源')).not.toBeNull();
  });

  it('skips missing attributes without breaking when MORE is absent (8.5)', () => {
    const { getByText, queryByText } = render(<WordDetailCard word={minimal} />);
    expect(getByText('erode')).toBeTruthy(); // card still renders
    expect(getByText(/少しずつ損なう/)).toBeTruthy();
    expect(queryByText('語源')).toBeNull(); // no MORE rows
    expect(queryByText('例文 / Examples')).toBeNull(); // empty core sections omitted
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
