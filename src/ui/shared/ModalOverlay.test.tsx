// @vitest-environment jsdom
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModalOverlay } from './ModalOverlay';

describe('<ModalOverlay/>', () => {
  it('renders an accessible dialog with aria-modal and a name', () => {
    render(
      <ModalOverlay onClose={() => {}} label="サンプル">
        <button>内側</button>
      </ModalOverlay>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('サンプル');
  });

  it('moves focus to the first focusable on open', () => {
    render(
      <ModalOverlay onClose={() => {}} label="x">
        <button data-testid="first">A</button>
        <button data-testid="second">B</button>
      </ModalOverlay>,
    );
    expect(document.activeElement).toBe(screen.getByTestId('first'));
  });

  it('locks body scroll while open and restores it on close', () => {
    const { unmount } = render(
      <ModalOverlay onClose={() => {}} label="x">
        <button>A</button>
      </ModalOverlay>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <ModalOverlay onClose={onClose} label="x">
        <button>A</button>
      </ModalOverlay>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape when closeOnEsc is false', () => {
    const onClose = vi.fn();
    render(
      <ModalOverlay onClose={onClose} label="x" closeOnEsc={false}>
        <button>A</button>
      </ModalOverlay>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a backdrop click but not on a panel click', () => {
    const onClose = vi.fn();
    render(
      <ModalOverlay onClose={onClose} label="x">
        <button>A</button>
      </ModalOverlay>,
    );
    fireEvent.mouseDown(screen.getByTestId('modal-panel'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab: wraps forward from the last focusable to the first', () => {
    render(
      <ModalOverlay onClose={() => {}} label="x">
        <button data-testid="first">A</button>
        <button data-testid="last">B</button>
      </ModalOverlay>,
    );
    const last = screen.getByTestId('last');
    last.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByTestId('first'));
  });

  it('traps Shift+Tab: wraps backward from the first focusable to the last', () => {
    render(
      <ModalOverlay onClose={() => {}} label="x">
        <button data-testid="first">A</button>
        <button data-testid="last">B</button>
      </ModalOverlay>,
    );
    const first = screen.getByTestId('first');
    first.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId('last'));
  });

  it('returns focus to the opener when it closes', () => {
    function Harness(): React.ReactElement {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button data-testid="opener" onClick={() => setOpen(true)}>
            開く
          </button>
          {open ? (
            <ModalOverlay onClose={() => setOpen(false)} label="x">
              <button data-testid="inside">内側</button>
              <button data-testid="close" onClick={() => setOpen(false)}>
                閉じる
              </button>
            </ModalOverlay>
          ) : null}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByTestId('inside'));
    fireEvent.click(screen.getByTestId('close'));
    expect(document.activeElement).toBe(opener);
  });
});
