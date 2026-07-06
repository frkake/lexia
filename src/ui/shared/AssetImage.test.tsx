// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AppProvider } from '../app/AppContext';
import { createContainer } from '../app/container';
import { AssetImage } from './AssetImage';
import { imageRef } from '../../infra/persistence/imageStore';
import type { UserId } from '../../types/domain';

describe('<AssetImage/>', () => {
  beforeEach(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:mock-${n++}`) as never;
    URL.revokeObjectURL = vi.fn() as never;
  });

  it('renders a plain data URL directly, without minting an object URL', () => {
    render(<AssetImage src="data:image/png;base64,AAAA" alt="x" />);
    expect(screen.getByAltText('x').getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('resolves a lexia-image ref via the container to an object URL, revoked on unmount', async () => {
    const userId = 'assetimg' as UserId;
    const container = await createContainer(userId, { cefrOf: () => undefined });
    await container.repos.images.put({
      imageId: 'i1',
      userId,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      mime: 'image/png',
      createdAt: 1,
    });

    const { unmount } = render(
      <AppProvider container={container}>
        <AssetImage src={imageRef('i1')} alt="scene" />
      </AppProvider>,
    );

    await waitFor(() => expect(screen.getByAltText('scene').getAttribute('src')).toBe('blob:mock-0'));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-0');
    container.db.close();
  });

  it('leaves the src unresolved (placeholder-friendly) when the referenced image is missing', async () => {
    const userId = 'assetimg_missing' as UserId;
    const container = await createContainer(userId, { cefrOf: () => undefined });
    render(
      <AppProvider container={container}>
        <AssetImage src={imageRef('nope')} alt="gone" />
      </AppProvider>,
    );
    // No blob → no object URL; the img simply has no src (caller's outer guard shows its placeholder).
    await waitFor(() => expect(URL.createObjectURL).not.toHaveBeenCalled());
    expect(screen.getByAltText('gone').getAttribute('src')).toBeNull();
    container.db.close();
  });
});
