// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './AppShell';
import { playerStore } from '../state/stores/playerStore';

function routerAt(path: string) {
  return createMemoryRouter(
    [
      {
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, element: <div data-testid="dash">dashboard</div> },
          { path: 'read', element: <div data-testid="read">reading</div> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
}

describe('<AppShell/>', () => {
  it('renders the outlet content and attaches the resident audio to the player store', () => {
    const router = routerAt('/');
    const { getByTestId } = render(<RouterProvider router={router} />);
    expect(getByTestId('dash')).toBeTruthy();
    const audio = getByTestId('app-audio');
    expect(playerStore.getState().audio).toBe(audio);
  });

  it('keeps the same <audio> element mounted across navigation (7.1)', async () => {
    const router = routerAt('/');
    const { getByTestId } = render(<RouterProvider router={router} />);
    const before = getByTestId('app-audio');
    await act(async () => {
      await router.navigate('/read');
    });
    expect(getByTestId('read')).toBeTruthy();
    expect(getByTestId('app-audio')).toBe(before); // never recreated
  });

  it('docks the bottom player in a safe-area-aware container', () => {
    const router = routerAt('/');
    const { container } = render(<RouterProvider router={router} />);
    expect(container.querySelector('.bottom-player')).not.toBeNull();
    expect(container.querySelector('.app-shell')).not.toBeNull();
  });
});
