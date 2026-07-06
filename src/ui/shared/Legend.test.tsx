// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Legend } from './Legend';

describe('<Legend/>', () => {
  it('explains the five annotation meanings (4.4)', () => {
    const { getByText } = render(<Legend />);
    expect(getByText('新出')).toBeTruthy();
    expect(getByText('学習中')).toBeTruthy();
    expect(getByText('定着・再登場')).toBeTruthy();
    expect(getByText('コロケーション')).toBeTruthy();
    expect(getByText('気づき（右に解説）')).toBeTruthy();
  });

  it('names the idiom / set-phrase expression encoding (B-1 / B-2)', () => {
    const { getByText } = render(<Legend />);
    expect(getByText('イディオム・定型表現')).toBeTruthy();
  });

  it('names the syntax「読み方の気づき」encoding (C-4)', () => {
    const { getByText } = render(<Legend />);
    expect(getByText('読み方の気づき（構文）')).toBeTruthy();
  });
});
