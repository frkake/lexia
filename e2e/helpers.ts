import type { Page } from '@playwright/test';
import { tokenizer } from '../src/domain/tokenizer/joinService';
import type { PassageOutput, WordData } from '../src/types/domain';

/**
 * E2E fixtures + network mocks. The adjacent capabilities (generation / word-data / TTS)
 * are stubbed at the `/api/*` boundary with deterministic responses so the real app runs
 * end-to-end without a backend. The passage is deliberately cue-free so it passes the real
 * PassageValidator even though SetupRoute supplies no grounded word attributes.
 */

export const E2E_PASSAGE: PassageOutput = {
  meta: { title: 'A Decisive Agreement', theme: '交渉', level: 'B2', newCount: 1, reviewCount: 0, approxWords: 5 },
  sentences: [
    { tokens: ['We', 'reached', 'a', 'decisive', 'agreement', '.'], translationJa: '私たちは決定的な合意に達した。' },
  ],
  targetSpans: [
    { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4, wordId: 'decisive', surface: 'decisive', masteryDensity: 'new' },
  ],
  collocationSpans: [],
  noticeCues: [],
};

export const E2E_WORD: WordData = {
  wordId: 'decisive',
  headword: 'decisive',
  ipa: '/dɪˈsaɪsɪv/',
  pos: ['adjective'],
  register: 'neutral',
  connotation: '肯定的',
  frequency: 4,
  core: {
    meaningsJa: ['決定的な', '断固とした'],
    examples: [{ en: 'a decisive moment', ja: '決定的な瞬間' }],
    collocations: ['decisive action', 'a decisive factor'],
    synonymNuances: ['conclusive より口語的'],
  },
  more: {
    etymology: { prefix: 'de-', root: 'caedere（切る）' },
    semanticNetwork: { synonyms: ['conclusive'], antonyms: ['indecisive'], hypernyms: [], hyponyms: [], related: ['decision'] },
    wordFamily: ['decide', 'decision'],
    grammarPatterns: ['be decisive about X'],
  },
};

const DURATION_MS = 4000;
/** Onset spacing between word marks (ms); token i lights at i*STEP. */
export const MARK_STEP_MS = 400;

/** Byte-accurate word marks for the passage (id-independent — depends only on text). */
function buildMarks(): { start: number; end: number; timeMs: number }[] {
  const idx = tokenizer.index('e2e', E2E_PASSAGE);
  return idx.tokens
    .filter((t) => /[a-zA-Z0-9]/.test(t.text))
    .map((t, i) => ({ start: t.byteStart, end: t.byteEnd, timeMs: i * MARK_STEP_MS }));
}

/** Index of the word token 'decisive' among alphanumeric tokens (drives the seek target). */
export const DECISIVE_WORD_INDEX = 3; // We, reached, a, decisive
export const TOTAL_DURATION_MS = DURATION_MS;

/** A short silent 8-bit mono WAV as a data URL so the <audio> element can load + seek. */
function silentWavDataUrl(seconds = DURATION_MS / 1000): string {
  const sampleRate = 8000;
  const dataLen = Math.round(sampleRate * seconds);
  const buffer = Buffer.alloc(44 + dataLen);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLen, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28); // byte rate (8-bit mono)
  buffer.writeUInt16LE(1, 32); // block align
  buffer.writeUInt16LE(8, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLen, 40);
  buffer.fill(128, 44); // 8-bit unsigned silence
  return `data:audio/wav;base64,${buffer.toString('base64')}`;
}

/** Stub every adjacent `/api/*` capability with deterministic fixtures. */
export async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/passages:generate', (route) =>
    route.fulfill({ json: { passage: E2E_PASSAGE, stop_reason: 'end_turn' } }),
  );
  await page.route('**/api/words/**', (route) => route.fulfill({ json: E2E_WORD }));
  await page.route('**/api/tts:synthesize', (route) =>
    route.fulfill({
      json: { audioUrl: silentWavDataUrl(), format: 'audio/mpeg', durationMs: DURATION_MS, engine: 'polly', marks: buildMarks() },
    }),
  );
  await page.route('**/api/tts/word**', (route) => route.fulfill({ json: { url: silentWavDataUrl(1) } }));
}

/** Force the resident <audio> to load metadata so currentTime becomes settable. */
export async function ensureSeekable(page: Page): Promise<void> {
  await page.evaluate(() => {
    const a = document.querySelector('audio');
    if (a) {
      a.preload = 'auto';
      a.load();
    }
  });
  await page.waitForFunction(() => {
    const a = document.querySelector('audio');
    return !!a && a.readyState >= 1;
  });
}

/** Move the seek slider to a 0..1 fraction the React-controlled way (drives seekTo). */
export async function seek(page: Page, ratio: number): Promise<void> {
  await page.locator('input[aria-label="再生位置"]').evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, Math.round(ratio * 1000));
}

/** Add a manual target word in Setup and trigger generation. */
export async function generateFromSetup(page: Page, word = 'decisive'): Promise<void> {
  await page.goto('/setup');
  await page.getByRole('button', { name: '＋ 追加' }).click();
  await page.getByLabel('追加する単語').fill(word);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await page.getByTestId(`target-${word}`).waitFor();
  await page.getByRole('button', { name: '文章を生成する' }).click();
}
