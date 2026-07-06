// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SetupScreen, setupMissing, type CandidateWord } from './SetupScreen';
import type { SetupConfig } from '../../types/domain';

const CANDIDATES: CandidateWord[] = [
  { wordId: 'mitigate', surface: 'mitigate' },
  { wordId: 'concede', surface: 'concede' },
  { wordId: 'candid', surface: 'candid' },
];

function renderScreen(props: Parameters<typeof SetupScreen>[0] = {}) {
  return render(<SetupScreen {...props} />);
}

describe('setupMissing()', () => {
  it('reports nothing missing once an exam target is provided (target words optional)', () => {
    expect(setupMissing({ kind: 'eiken', value: '準1' }, [])).toEqual([]);
  });

  it('reports the level as missing when no exam target is chosen', () => {
    const missing = setupMissing(undefined, []);
    expect(missing).toContain('レベル');
    expect(missing.some((m) => m.includes('対象単語'))).toBe(false);
  });
});

describe('<SetupScreen/> (overhauled: intent / exam / word target / content type)', () => {
  it('replaces theme tags with a single-select learning intent (8.1/8.2)', () => {
    const { getByTestId, queryByTestId } = renderScreen({ candidates: CANDIDATES });
    // Old fine-grained theme tag UI is gone.
    expect(queryByTestId('theme-交渉')).toBeNull();
    // Learning intents are offered.
    expect(getByTestId('intent-business')).toBeTruthy();
    expect(getByTestId('intent-daily')).toBeTruthy();
    expect(getByTestId('intent-toeic')).toBeTruthy();
  });

  it('shows a persistent config warning banner when configWarning is set, and hides it otherwise (F-1)', () => {
    const warning = '生成サーバの API キーが未設定です。server/.env に OPENAI_API_KEY を設定してサーバを再起動すると文章を生成できます。';
    const { queryByTestId, rerender } = renderScreen({ candidates: CANDIDATES });
    expect(queryByTestId('config-warning')).toBeNull();
    rerender(<SetupScreen candidates={CANDIDATES} configWarning={warning} />);
    expect(queryByTestId('config-warning')?.textContent).toContain('OPENAI_API_KEY');
  });

  it('offers the exam-based difficulty picker and the content-type selector (9.1/6.1)', () => {
    const { getByTestId } = renderScreen({ candidates: CANDIDATES });
    expect(getByTestId('exam-kind-eiken')).toBeTruthy();
    expect(getByTestId('content-type-article')).toBeTruthy();
    expect(getByTestId('content-type-short_story')).toBeTruthy();
    expect(getByTestId('content-type-long_story')).toBeTruthy();
    expect(getByTestId('content-type-listening_scene')).toBeTruthy();
  });

  it('single-selects the learning intent (only one active at a time, 8.2)', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText } = renderScreen({ candidates: [], onGenerate });
    fireEvent.click(getByTestId('exam-value-2')); // choose a level so generation is allowed
    fireEvent.click(getByTestId('intent-toeic'));
    fireEvent.click(getByTestId('intent-academic'));
    fireEvent.click(getByText('文章を生成する'));
    expect(onGenerate.mock.calls[0]![0].intent).toBe('academic');
  });

  it('emits a SetupConfig with examTarget / intent / wordTarget / contentType (8/9/7/6)', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText, getByLabelText } = renderScreen({ candidates: CANDIDATES, onGenerate });

    fireEvent.click(getByTestId('exam-kind-toeic'));
    fireEvent.click(getByTestId('exam-value-800'));
    fireEvent.click(getByTestId('intent-business'));
    fireEvent.change(getByLabelText('新出単語の割合'), { target: { value: '0.5' } });
    fireEvent.change(getByLabelText('文章の長さ'), { target: { value: '700' } });
    fireEvent.click(getByText('文章を生成する'));

    expect(onGenerate).toHaveBeenCalledTimes(1);
    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.examTarget).toEqual({ kind: 'toeic', value: '800' });
    expect(cfg.intent).toBe('business');
    expect(cfg.newWordRatio).toBeCloseTo(0.5);
    expect(cfg.wordTarget).toBe(700);
    expect(cfg.contentType).toBe('article');
    expect(cfg.advancedDifficulty).toBeUndefined();
    expect(cfg.targetWordIds).toEqual(['mitigate', 'concede', 'candid']);
    // Legacy fields removed.
    expect((cfg as { themes?: unknown }).themes).toBeUndefined();
    expect((cfg as { length?: unknown }).length).toBeUndefined();
  });

  it('offers advanced overrides for vocabulary level and sentence-structure readability', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText } = renderScreen({ candidates: [], onGenerate });
    fireEvent.click(getByTestId('exam-value-2'));
    fireEvent.change(getByTestId('advanced-vocabulary-level'), { target: { value: 'C1' } });
    fireEvent.change(getByTestId('advanced-readability-level'), { target: { value: 'advanced' } });
    fireEvent.click(getByText('文章を生成する'));
    expect(onGenerate.mock.calls[0]![0].advancedDifficulty).toEqual({
      vocabularyLevel: 'C1',
      readabilityLevel: 'advanced',
    });
  });

  it('syncs advanced level controls to the selected target level preset', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText } = renderScreen({ candidates: [], onGenerate });

    fireEvent.click(getByTestId('exam-kind-toeic'));
    fireEvent.click(getByTestId('exam-value-800'));
    expect((getByTestId('advanced-vocabulary-level') as HTMLSelectElement).value).toBe('B2');
    expect((getByTestId('advanced-readability-level') as HTMLSelectElement).value).toBe('standard');
    expect(getByTestId('advanced-level-mode').textContent).toContain('B2');

    fireEvent.click(getByTestId('exam-value-960'));
    expect((getByTestId('advanced-vocabulary-level') as HTMLSelectElement).value).toBe('C1');
    expect((getByTestId('advanced-readability-level') as HTMLSelectElement).value).toBe('advanced');

    fireEvent.click(getByText('文章を生成する'));
    expect(onGenerate.mock.calls[0]![0].advancedDifficulty).toBeUndefined();
  });

  it('treats advanced level values as a custom target-level preset that can be reset', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText } = renderScreen({
      candidates: [],
      initial: { examTarget: { kind: 'eiken', value: '2' } },
      onGenerate,
    });

    fireEvent.change(getByTestId('advanced-vocabulary-level'), { target: { value: 'C1' } });
    expect(getByTestId('advanced-level-mode').textContent).toBe('カスタム');
    fireEvent.click(getByTestId('reset-advanced-level'));
    expect((getByTestId('advanced-vocabulary-level') as HTMLSelectElement).value).toBe('B1');
    expect((getByTestId('advanced-readability-level') as HTMLSelectElement).value).toBe('easy');

    fireEvent.click(getByText('文章を生成する'));
    expect(onGenerate.mock.calls[0]![0].advancedDifficulty).toBeUndefined();
  });

  it('reveals genre + homage inputs only when a story content type is chosen (6.4)', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, queryByTestId, getByText, getByLabelText } = renderScreen({
      candidates: [],
      onGenerate,
    });
    fireEvent.click(getByTestId('exam-value-2')); // choose a level so generation is allowed
    // Article: no genre picker.
    expect(queryByTestId('genre-fantasy')).toBeNull();
    fireEvent.click(getByTestId('content-type-short_story'));
    // Story: genre options appear (fantasy / sci-fi / mystery at minimum).
    expect(getByTestId('genre-fantasy')).toBeTruthy();
    expect(getByTestId('genre-sci_fi')).toBeTruthy();
    expect(getByTestId('genre-mystery')).toBeTruthy();
    fireEvent.click(getByTestId('genre-mystery'));
    fireEvent.change(getByLabelText('オマージュ作品（任意）'), { target: { value: 'Sherlock Holmes' } });
    fireEvent.click(getByText('文章を生成する'));
    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.contentType).toBe('short_story');
    expect(cfg.storyOptions).toEqual({ genre: 'mystery', homageTitle: 'Sherlock Holmes' });
  });

  it('emits listening scene options with the selected accent and does not show story genre controls', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, queryByTestId, getByText } = renderScreen({
      candidates: [],
      initial: { examTarget: { kind: 'eiken', value: '2' } },
      onGenerate,
    });

    fireEvent.click(getByTestId('content-type-listening_scene'));
    expect(queryByTestId('genre-fantasy')).toBeNull();
    fireEvent.change(getByTestId('listening-scene-kind'), { target: { value: 'street_interview' } });
    fireEvent.change(getByTestId('listening-accent'), { target: { value: 'in' } });
    fireEvent.change(getByTestId('listening-noise'), { target: { value: 'medium' } });
    fireEvent.click(getByText('文章を生成する'));

    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.contentType).toBe('listening_scene');
    expect(cfg.storyOptions).toBeUndefined();
    expect(cfg.listeningOptions).toEqual({ sceneKind: 'street_interview', accent: 'in', noiseLevel: 'medium' });
  });

  it('clamps the emitted word target into the selected story range (7.3)', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText } = renderScreen({
      candidates: [],
      initial: { examTarget: { kind: 'eiken', value: '2' }, wordTarget: 400, contentType: 'article' },
      onGenerate,
    });
    fireEvent.click(getByTestId('content-type-long_story'));
    fireEvent.click(getByText('文章を生成する'));
    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.contentType).toBe('long_story');
    expect(cfg.wordTarget).toBe(800);
  });

  it('excludes a tapped candidate from the target list', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText } = renderScreen({
      candidates: CANDIDATES,
      initial: { examTarget: { kind: 'eiken', value: '準1' } },
      onGenerate,
    });
    fireEvent.click(getByTestId('target-concede')); // toggle exclude
    fireEvent.click(getByText('文章を生成する'));
    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.targetWordIds).toEqual(['mitigate', 'candid']);
    expect(cfg.excludedWordIds).toContain('concede');
  });

  it('refreshes auto candidates without dropping manual additions or exclusions', () => {
    const onRefreshCandidates = vi.fn<(s: SetupConfig) => void>();
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText, getByLabelText, rerender, queryByTestId } = renderScreen({
      candidates: CANDIDATES,
      initial: { examTarget: { kind: 'eiken', value: '2' } },
      onRefreshCandidates,
      onGenerate,
    });

    fireEvent.click(getByTestId('target-concede'));
    fireEvent.click(getByText('＋ 追加'));
    fireEvent.change(getByLabelText('追加する単語'), { target: { value: 'zest' } });
    fireEvent.click(getByText('追加'));
    fireEvent.click(getByTestId('refresh-candidates'));

    expect(onRefreshCandidates).toHaveBeenCalledTimes(1);
    expect(onRefreshCandidates.mock.calls[0]![0].excludedWordIds).toContain('concede');
    expect(onRefreshCandidates.mock.calls[0]![0].targetWordIds).toContain('zest');

    rerender(
      <SetupScreen
        candidates={[{ wordId: 'adapt', surface: 'adapt' }]}
        initial={{ examTarget: { kind: 'eiken', value: '2' } }}
        onRefreshCandidates={onRefreshCandidates}
        onGenerate={onGenerate}
      />,
    );
    expect(queryByTestId('target-mitigate')).toBeNull();
    expect(getByTestId('target-adapt')).toBeTruthy();

    fireEvent.click(getByText('文章を生成する'));
    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.targetWordIds).toEqual(['adapt', 'zest']);
    expect(cfg.excludedWordIds).toContain('concede');
  });

  it('resets manual edits locally and notifies the route with no setup payload (A-2-1)', () => {
    const onResetTargetWords = vi.fn<() => void>();
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText, getByLabelText, queryByTestId } = renderScreen({
      candidates: CANDIDATES,
      initial: { examTarget: { kind: 'eiken', value: '2' } },
      onResetTargetWords,
      onGenerate,
    });

    // Hand-edit: exclude one candidate, add a manual word.
    fireEvent.click(getByTestId('target-concede'));
    fireEvent.click(getByText('＋ 追加'));
    fireEvent.change(getByLabelText('追加する単語'), { target: { value: 'zest' } });
    fireEvent.click(getByText('追加'));
    expect(getByTestId('target-added-zest')).toBeTruthy();

    fireEvent.click(getByTestId('reset-candidates'));

    // The route is merely notified — no setup (and therefore no level/slider values) is emitted, so
    // reset can never silently commit an unconfirmed form value.
    expect(onResetTargetWords).toHaveBeenCalledTimes(1);
    expect(onResetTargetWords.mock.calls[0]).toEqual([]);

    // Manual addition is gone; the previously-excluded candidate is selected again.
    expect(queryByTestId('target-added-zest')).toBeNull();
    expect(getByTestId('target-concede').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(getByText('文章を生成する'));
    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.targetWordIds).toEqual(['mitigate', 'concede', 'candid']);
    expect(cfg.excludedWordIds).toEqual([]);
  });

  it('disables reset when there are no manual edits to clear', () => {
    const onResetTargetWords = vi.fn<() => void>();
    const { getByTestId } = renderScreen({
      candidates: CANDIDATES,
      initial: { examTarget: { kind: 'eiken', value: '2' } },
      onResetTargetWords,
    });
    expect(getByTestId('reset-candidates').hasAttribute('disabled')).toBe(true);
    fireEvent.click(getByTestId('target-concede'));
    expect(getByTestId('reset-candidates').hasAttribute('disabled')).toBe(false);
  });

  it('shows no target chips by default — nothing is prefilled (A-1-1)', () => {
    const { container } = renderScreen({ initial: { examTarget: { kind: 'eiken', value: '2' } } });
    expect(container.querySelectorAll('[data-testid^="target-"]').length).toBe(0);
  });

  it('puts only manually-added words into targetWordIds when no candidates are previewed (A-1-1)', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByText, getByLabelText, getByTestId } = renderScreen({
      initial: { examTarget: { kind: 'eiken', value: '2' } },
      onGenerate,
    });
    fireEvent.click(getByText('＋ 追加'));
    fireEvent.change(getByLabelText('追加する単語'), { target: { value: 'zeal' } });
    fireEvent.click(getByText('追加'));
    expect(getByTestId('target-added-zeal')).toBeTruthy();
    fireEvent.click(getByText('文章を生成する'));
    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.targetWordIds).toEqual(['zeal']);
    expect(cfg.excludedWordIds).toEqual([]);
  });

  it('does not double-render a word present in both initial additions and late-arriving candidates (A-2-1)', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const initial: Partial<SetupConfig> = { examTarget: { kind: 'eiken', value: '2' }, targetWordIds: ['mitigate'] };
    const { rerender, getByTestId, queryByTestId, getByText } = renderScreen({ initial, onGenerate });

    // Seeded as a manual addition chip (candidates are empty at first).
    expect(getByTestId('target-added-mitigate')).toBeTruthy();

    // Candidates arrive asynchronously and include the same word.
    rerender(
      <SetupScreen initial={initial} candidates={[{ wordId: 'mitigate', surface: 'mitigate' }]} onGenerate={onGenerate} />,
    );

    // It now renders exactly once, as a candidate chip; the added duplicate is dropped.
    expect(getByTestId('target-mitigate')).toBeTruthy();
    expect(queryByTestId('target-added-mitigate')).toBeNull();

    fireEvent.click(getByText('文章を生成する'));
    expect(onGenerate.mock.calls[0]![0].targetWordIds).toEqual(['mitigate']);
  });

  it('omits the reset button when no reset handler is wired', () => {
    const { queryByTestId } = renderScreen({ candidates: CANDIDATES });
    expect(queryByTestId('reset-candidates')).toBeNull();
  });

  it('seeds selections from the initial config', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByText } = renderScreen({
      candidates: CANDIDATES,
      initial: { examTarget: { kind: 'eiken', value: '1' }, intent: 'travel', wordTarget: 600, contentType: 'article' },
      onGenerate,
    });
    fireEvent.click(getByText('文章を生成する'));
    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.examTarget).toEqual({ kind: 'eiken', value: '1' });
    expect(cfg.intent).toBe('travel');
    expect(cfg.wordTarget).toBe(600);
  });

  it('shows generation progress and service errors', () => {
    const { getByRole, getByText } = renderScreen({
      candidates: CANDIDATES,
      refreshingCandidates: true,
      candidateRefreshError: '単語候補を更新できませんでした。',
      generating: true,
      generationError: '生成サービスに接続できませんでした。',
      onRefreshCandidates: vi.fn(),
    });
    expect(getByRole('button', { name: '更新中…' }).getAttribute('aria-busy')).toBe('true');
    expect(getByText('単語候補を更新できませんでした。')).toBeTruthy();
    expect(getByRole('button', { name: '生成しています…' }).getAttribute('aria-busy')).toBe('true');
    expect(getByText('生成サービスに接続できませんでした。')).toBeTruthy();
  });

  it('replaces the button with the progress panel and freezes the form while a run is active (D-7)', () => {
    const onCancel = vi.fn();
    const { container, getByTestId, queryByText } = renderScreen({
      candidates: CANDIDATES,
      generationProgress: { phase: 'passage', startedAt: 0, error: null, onCancel },
    });
    // The plain generate button is gone; the phased progress panel is shown instead.
    expect(queryByText('文章を生成する')).toBeNull();
    expect(getByTestId('generation-progress').getAttribute('data-phase')).toBe('passage');
    // The whole form is frozen: the wrapping <fieldset> is disabled (disables every nested control).
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    // Cancel is reachable (outside the disabled fieldset) and wired.
    fireEvent.click(getByTestId('cancel-generation'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the error + 再試行 in the panel and keeps the form editable on an error (D-7)', () => {
    const onGenerate = vi.fn();
    const { container, getByTestId, queryByText } = renderScreen({
      candidates: CANDIDATES,
      initial: { examTarget: { kind: 'eiken', value: '2' } },
      onGenerate,
      generationProgress: {
        phase: 'error',
        startedAt: null,
        error: '生成に時間がかかりすぎたため中断しました。',
        onCancel: vi.fn(),
      },
    });
    expect(getByTestId('generation-progress').getAttribute('data-phase')).toBe('error');
    expect(queryByText('生成に時間がかかりすぎたため中断しました。')).toBeTruthy();
    // The form is NOT frozen on error (the learner can adjust + retry).
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false);
    // 再試行 re-emits the setup for a fresh run.
    fireEvent.click(getByTestId('retry-generation'));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('lists excluded words and un-excludes them individually and in bulk (A-2-3)', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, queryByTestId, getByText } = renderScreen({
      candidates: CANDIDATES,
      initial: { examTarget: { kind: 'eiken', value: '2' } },
      onGenerate,
    });
    // Nothing excluded yet → no list.
    expect(queryByTestId('excluded-words')).toBeNull();

    fireEvent.click(getByTestId('target-mitigate'));
    fireEvent.click(getByTestId('target-concede'));
    expect(getByTestId('excluded-words').textContent).toContain('除外中の単語 (2)');
    expect(getByTestId('excluded-mitigate')).toBeTruthy();

    // Un-exclude one from the list → it leaves the list and rejoins the selected candidates.
    fireEvent.click(getByTestId('excluded-mitigate'));
    expect(queryByTestId('excluded-mitigate')).toBeNull();
    expect(getByTestId('excluded-words').textContent).toContain('除外中の単語 (1)');
    expect(getByTestId('target-mitigate').getAttribute('aria-pressed')).toBe('true');

    // Bulk clear empties the list; generation then excludes nothing.
    fireEvent.click(getByTestId('clear-excluded'));
    expect(queryByTestId('excluded-words')).toBeNull();
    fireEvent.click(getByText('文章を生成する'));
    expect(onGenerate.mock.calls[0]![0].excludedWordIds).toEqual([]);
  });

  it('surfaces previously-excluded words even when they are not current candidates (A-2-3)', () => {
    const { getByTestId } = renderScreen({
      candidates: [],
      initial: { examTarget: { kind: 'eiken', value: '2' }, excludedWordIds: ['obscure'] },
    });
    expect(getByTestId('excluded-words').textContent).toContain('除外中の単語 (1)');
    expect(getByTestId('excluded-obscure').textContent).toContain('obscure');
  });

  it('shows the exclude/restore affordance and reflects state via aria on candidate chips (A-2-4)', () => {
    const { getByTestId } = renderScreen({
      candidates: CANDIDATES,
      initial: { examTarget: { kind: 'eiken', value: '2' } },
    });
    const chip = getByTestId('target-mitigate');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.getAttribute('aria-label')).toBe('mitigate を除外');
    expect(chip.textContent).toContain('×');

    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(chip.getAttribute('aria-label')).toBe('mitigate の除外を戻す');
    expect(chip.textContent).toContain('↩');
  });

  it('gives manual chips a delete affordance and aria-label (A-2-4)', () => {
    const { getByTestId, getByText, getByLabelText } = renderScreen({
      initial: { examTarget: { kind: 'eiken', value: '2' } },
    });
    fireEvent.click(getByText('＋ 追加'));
    fireEvent.change(getByLabelText('追加する単語'), { target: { value: 'zeal' } });
    fireEvent.click(getByText('追加'));
    const chip = getByTestId('target-added-zeal');
    expect(chip.getAttribute('aria-label')).toBe('zeal を削除');
    expect(chip.textContent).toContain('×');
  });

  it('annotates the advanced vocabulary levels and the target-linked badge with exam grades (A-3-3)', () => {
    const { getByTestId } = renderScreen({
      candidates: [],
      initial: { examTarget: { kind: 'eiken', value: '2' } },
    });
    // Badge for the B1 preset shows the 英検 grade next to the CEFR symbol.
    expect(getByTestId('advanced-level-mode').textContent).toContain('B1（英検2級相当）');

    const select = getByTestId('advanced-vocabulary-level');
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toContain('B1（英検2級・TOEIC 550–784 相当）');
    expect(labels.some((l) => l?.includes('C2（英検対象外）'))).toBe(true);
    // The option value stays the bare CEFR so the emitted config is unchanged.
    expect((select.querySelector('option') as HTMLOptionElement).value).toBe('A2');
  });
});
