/**
 * L4 — GenerationSettingsScreen: 生成のふるまい設定. Presentational card rendered by the settings
 * route above データ管理. Currently one choice: staged delivery (本文ができ次第表示し、解説・イラスト・
 * 音声は準備でき次第あとから流し込む — default) vs batch (従来どおり注釈まで揃ってから開く).
 */

import type { CSSProperties } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import type { Settings } from '../../types/domain';

export type GenerationMode = NonNullable<Settings['generationMode']>;

export interface GenerationSettingsScreenProps {
  mode: GenerationMode;
  onModeChange(mode: GenerationMode): void;
}

const OPTIONS: { value: GenerationMode; label: string; description: string }[] = [
  {
    value: 'staged',
    label: '段階的に生成（推奨）',
    description: '本文ができた時点ですぐ読み始められます。学習ガイドの解説・イラスト・音声は、準備ができたものから順に表示されます。',
  },
  {
    value: 'batch',
    label: '一括で生成',
    description: '本文と学習ガイドの解説が揃ってから文章を開きます。開いた瞬間からすべての注釈が表示されますが、待ち時間は長くなります。',
  },
];

export function GenerationSettingsScreen({ mode, onModeChange }: GenerationSettingsScreenProps) {
  return (
    <section style={cardStyle} aria-labelledby="generation-settings-title">
      <h2 id="generation-settings-title" style={sectionTitleStyle}>
        文章の生成方法
      </h2>
      <p style={sectionLeadStyle}>「文章を生成する」で各要素をどの順で用意するかを選べます。次回の生成から適用されます。</p>
      <div role="radiogroup" aria-label="文章の生成方法">
        {OPTIONS.map((option) => (
          <label key={option.value} style={optionRowStyle(mode === option.value)}>
            <input
              type="radio"
              name="generation-mode"
              data-testid={`generation-mode-${option.value}`}
              checked={mode === option.value}
              onChange={() => onModeChange(option.value)}
            />
            <span style={optionBodyStyle}>
              <span style={optionLabelStyle}>{option.label}</span>
              <span style={optionDescriptionStyle}>{option.description}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

const cardStyle: CSSProperties = {
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: '22px 24px',
  marginBottom: 18,
};
const sectionTitleStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 15,
  fontWeight: 700,
  color: colors.ink,
  margin: '0 0 8px',
};
const sectionLeadStyle: CSSProperties = {
  fontFamily: fonts.bodyJp,
  fontSize: 13,
  lineHeight: 1.7,
  color: colors.muted,
  margin: '0 0 16px',
};
const optionRowStyle = (active: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 12px',
  borderRadius: radius.control,
  border: `1px solid ${active ? colors.primaryBorder : colors.borderCard}`,
  background: active ? colors.surfaceBlue : 'transparent',
  marginBottom: 8,
  cursor: 'pointer',
});
const optionBodyStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3 };
const optionLabelStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13.5,
  fontWeight: 600,
  color: colors.ink,
};
const optionDescriptionStyle: CSSProperties = {
  fontFamily: fonts.bodyJp,
  fontSize: 12,
  lineHeight: 1.7,
  color: colors.muted,
};
