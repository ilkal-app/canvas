import { describe, expect, it, vi } from 'vitest';

import { pageListCanEditOf, pageListOf } from './page-list-role.js';

describe('the floating board bar’s page role', () => {
  it('is the loading role while the board loads, then the connection’s, with no gap', () => {
    // An editor: the loading layout says so, and once loaded the role says so in the same render,
    // before the shell state's canEdit catches up, so Add page never leaves the bar.
    expect(pageListCanEditOf({ isLoading: true, hasEditingLayoutWhileLoading: true }, false)).toBe(
      true,
    );
    expect(pageListCanEditOf({ isLoading: false, hasEditingLayoutWhileLoading: true }, true)).toBe(
      true,
    );
    // A viewer never gets it, loading or loaded.
    expect(pageListCanEditOf({ isLoading: true, hasEditingLayoutWhileLoading: false }, false)).toBe(
      false,
    );
    expect(pageListCanEditOf({ isLoading: false }, false)).toBe(false);
    // Loading with no layout role given: the role decides.
    expect(pageListCanEditOf({ isLoading: true }, false)).toBe(false);
  });

  it('carries the selection and the notice', () => {
    const onNotice = vi.fn();
    expect(pageListOf({}, true, [], onNotice)).toEqual({
      canEdit: true,
      selectedIds: [],
      onNotice,
    });
  });
});
