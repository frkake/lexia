/**
 * L4 — DataManagementScreen: the backup / restore surface (F-5 第1段). Presentational — the route
 * wraps it and wires the container's SyncAdapter. "バックアップをダウンロード" exports the learner's data
 * as a JSON file (optionally without illustration bytes for a small file); "バックアップから復元" reads a
 * chosen file and, after an overwrite-warning confirmation (ModalOverlay), imports it. Success / failure
 * feedback is surfaced by the route via the shared toast surface (design decision D6).
 */

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ModalOverlay } from '../shared/ModalOverlay';
import { colors, fonts, radius } from '../theme/tokens';

export interface DataManagementScreenProps {
  /** Download a backup file. `includeImages` false ⇒ a small text-only backup. */
  onExport(includeImages: boolean): void | Promise<void>;
  /** Restore the chosen backup file (already confirmed). */
  onImport(file: File): void | Promise<void>;
  exporting?: boolean;
  importing?: boolean;
  /** Extra settings sections rendered above the backup cards (inside the same page shell). */
  children?: ReactNode;
}

export function DataManagementScreen({
  onExport,
  onImport,
  exporting = false,
  importing = false,
  children,
}: DataManagementScreenProps) {
  const [includeImages, setIncludeImages] = useState(true);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = (): void => inputRef.current?.click();

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0] ?? null;
    // Allow re-selecting the same file later (change won't fire otherwise).
    event.target.value = '';
    if (file) setPendingFile(file);
  };

  const confirmImport = (): void => {
    const file = pendingFile;
    setPendingFile(null);
    if (file) void onImport(file);
  };

  return (
    <div style={pageStyle}>
      <div style={shellStyle}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={titleStyle}>設定</h1>
          <p style={leadStyle}>
            学習データはこの端末のブラウザ内にのみ保存されています。定期的にバックアップを保存しておくと、ブラウザのデータ消去や端末の変更でも学習資産を失いません。
          </p>
        </header>

        {children}

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>バックアップをエクスポート</h2>
          <p style={sectionLeadStyle}>
            スケジュール・復習履歴・進捗・設定に加え、文章・物語・単語解説・イラストを 1 つの JSON ファイルに書き出します。
          </p>
          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              data-testid="include-images"
              checked={includeImages}
              onChange={(event) => setIncludeImages(event.target.checked)}
            />
            <span>画像（イラスト）を含める</span>
            <span style={hintStyle}>オフにするとファイルサイズを大幅に小さくできます</span>
          </label>
          <button
            type="button"
            data-testid="export-backup"
            onClick={() => void onExport(includeImages)}
            disabled={exporting}
            aria-busy={exporting}
            style={primaryButtonStyle(exporting)}
          >
            {exporting ? '書き出しています…' : 'バックアップをダウンロード'}
          </button>
        </section>

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>バックアップから復元</h2>
          <p style={sectionLeadStyle}>
            以前に書き出したバックアップファイルを読み込みます。現在この端末にあるデータに上書き・追記されます。
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            data-testid="import-backup-input"
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            data-testid="import-backup-button"
            onClick={pickFile}
            disabled={importing}
            aria-busy={importing}
            style={secondaryButtonStyle(importing)}
          >
            {importing ? '復元しています…' : 'ファイルを選択して復元'}
          </button>
        </section>
      </div>

      {pendingFile ? (
        <ModalOverlay
          onClose={() => setPendingFile(null)}
          labelledBy="import-confirm-title"
          describedBy="import-confirm-body"
          panelStyle={confirmPanelStyle}
        >
          <h2 id="import-confirm-title" style={confirmTitleStyle}>
            バックアップから復元しますか？
          </h2>
          <p id="import-confirm-body" style={confirmBodyStyle}>
            「{pendingFile.name}」を読み込みます。現在の学習データに上書き・追記され、この操作は取り消せません。
          </p>
          <div style={confirmActionsStyle}>
            <button type="button" data-testid="cancel-import" onClick={() => setPendingFile(null)} style={cancelButtonStyle}>
              キャンセル
            </button>
            <button type="button" data-testid="confirm-import" onClick={confirmImport} style={confirmButtonStyle}>
              復元する
            </button>
          </div>
        </ModalOverlay>
      ) : null}
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: '100%',
  background: colors.surfacePage,
  padding: '40px 24px 64px',
};

const shellStyle: CSSProperties = { width: '100%', maxWidth: 680, margin: '0 auto' };

const titleStyle: CSSProperties = {
  fontFamily: fonts.serifJp,
  fontSize: 28,
  fontWeight: 600,
  color: colors.ink,
  margin: '0 0 8px',
};

const leadStyle: CSSProperties = {
  fontFamily: fonts.bodyJp,
  fontSize: 14,
  lineHeight: 1.75,
  color: colors.inkSoft,
  margin: 0,
};

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

const checkboxRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  fontFamily: fonts.ui,
  fontSize: 13,
  color: colors.body,
  marginBottom: 18,
};

const hintStyle: CSSProperties = {
  flexBasis: '100%',
  fontFamily: fonts.ui,
  fontSize: 11.5,
  color: colors.faint,
};

const primaryButtonStyle = (busy: boolean): CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 700,
  color: colors.surfaceCard,
  background: colors.primary,
  border: `1px solid ${colors.primary}`,
  borderRadius: radius.control,
  padding: '10px 18px',
  cursor: busy ? 'wait' : 'pointer',
  opacity: busy ? 0.7 : 1,
});

const secondaryButtonStyle = (busy: boolean): CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 700,
  color: colors.primary,
  background: colors.surfaceBlue,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.control,
  padding: '10px 18px',
  cursor: busy ? 'wait' : 'pointer',
  opacity: busy ? 0.7 : 1,
});

const confirmPanelStyle: CSSProperties = { maxWidth: 'min(440px, 100%)', padding: '24px 26px' };

const confirmTitleStyle: CSSProperties = {
  fontFamily: fonts.serifJp,
  fontSize: 19,
  fontWeight: 600,
  color: colors.ink,
  margin: '0 0 10px',
};

const confirmBodyStyle: CSSProperties = {
  fontFamily: fonts.bodyJp,
  fontSize: 13.5,
  lineHeight: 1.7,
  color: colors.inkSoft,
  margin: '0 0 22px',
};

const confirmActionsStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 10 };

const cancelButtonStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: colors.muted,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  padding: '9px 16px',
  cursor: 'pointer',
};

const confirmButtonStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 700,
  color: colors.surfaceCard,
  background: colors.primary,
  border: `1px solid ${colors.primary}`,
  borderRadius: radius.control,
  padding: '9px 16px',
  cursor: 'pointer',
};
