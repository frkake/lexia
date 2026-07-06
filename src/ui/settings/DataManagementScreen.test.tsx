// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataManagementScreen } from './DataManagementScreen';
import { AppProvider } from '../app/AppContext';
import { createContainer } from '../app/container';
import { SettingsRoute } from '../app/routes';
import { toastStore } from '../../state/stores/toastStore';
import type { UserId } from '../../types/domain';

describe('<DataManagementScreen/>', () => {
  it('exports with images by default and respects the checkbox', () => {
    const onExport = vi.fn();
    render(<DataManagementScreen onExport={onExport} onImport={vi.fn()} />);

    fireEvent.click(screen.getByTestId('export-backup'));
    expect(onExport).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByTestId('include-images')); // uncheck
    fireEvent.click(screen.getByTestId('export-backup'));
    expect(onExport).toHaveBeenLastCalledWith(false);
  });

  it('gates import behind an overwrite confirmation; cancel does not import, confirm does', () => {
    const onImport = vi.fn();
    render(<DataManagementScreen onExport={vi.fn()} onImport={onImport} />);
    const input = screen.getByTestId('import-backup-input') as HTMLInputElement;
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });

    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByTestId('confirm-import')).toBeTruthy(); // modal opened

    fireEvent.click(screen.getByTestId('cancel-import'));
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-import')).toBeNull(); // modal closed

    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByTestId('confirm-import'));
    expect(onImport).toHaveBeenCalledWith(file);
  });
});

describe('SettingsRoute (backup wiring)', () => {
  beforeEach(() => {
    toastStore.getState().clear();
    URL.createObjectURL = vi.fn(() => 'blob:mock') as never;
    URL.revokeObjectURL = vi.fn() as never;
  });

  it('downloads a backup and surfaces a success toast on export', async () => {
    const userId = 'settings_export' as UserId;
    const container = await createContainer(userId, { cefrOf: () => undefined });
    const exportSpy = vi.spyOn(container.sync, 'export');

    render(
      <MemoryRouter>
        <AppProvider container={container}>
          <SettingsRoute />
        </AppProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('export-backup'));
    await waitFor(() => expect(exportSpy).toHaveBeenCalledWith(userId, { includeImages: true }));
    await waitFor(() => expect(toastStore.getState().toasts.some((t) => t.tone === 'success')).toBe(true));
    expect(URL.createObjectURL).toHaveBeenCalled();
    container.db.close();
  });

  it('imports a chosen backup after confirmation and surfaces a success toast', async () => {
    const userId = 'settings_import' as UserId;
    const container = await createContainer(userId, { cefrOf: () => undefined });
    const importSpy = vi.spyOn(container.sync, 'import').mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <AppProvider container={container}>
          <SettingsRoute />
        </AppProvider>
      </MemoryRouter>,
    );

    const input = screen.getByTestId('import-backup-input') as HTMLInputElement;
    const file = new File(['{"formatVersion":2}'], 'backup.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByTestId('confirm-import'));

    await waitFor(() => expect(importSpy).toHaveBeenCalledWith(userId, file));
    await waitFor(() => expect(toastStore.getState().toasts.some((t) => t.tone === 'success')).toBe(true));
    container.db.close();
  });
});
