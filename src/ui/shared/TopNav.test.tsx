// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TopNav } from './TopNav';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TopNav />
    </MemoryRouter>,
  );
}

describe('<TopNav/>', () => {
  it('shows the brand and the primary destinations', () => {
    const { getByText } = renderAt('/');
    expect(getByText(/Lexia/)).toBeTruthy();
    expect(getByText('ダッシュボード')).toBeTruthy();
    expect(getByText('学習をはじめる')).toBeTruthy();
    expect(getByText('読む')).toBeTruthy();
    expect(getByText('復習')).toBeTruthy();
    expect(getByText('単語帳')).toBeTruthy();
  });

  it('marks the current route as active (aria-current)', () => {
    const { getByText } = renderAt('/review');
    expect(getByText('復習').getAttribute('aria-current')).toBe('page');
    expect(getByText('読む').getAttribute('aria-current')).toBeNull();
  });
});
