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
    expect(getByText(/気づき/)).toBeTruthy();
  });
});
