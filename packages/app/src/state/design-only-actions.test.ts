// Which actions are the design tools' only: Create component, and nothing else.
import { describe, expect, it } from 'vitest';

import { isDesignOnlyAction } from './design-only-actions.js';

describe('isDesignOnlyAction', () => {
  it('is true for Create component only', () => {
    expect(isDesignOnlyAction({ type: 'arrange', command: 'createComponent' })).toBe(true);
    expect(isDesignOnlyAction({ type: 'arrange', command: 'group' })).toBe(false);
    expect(isDesignOnlyAction({ type: 'selection', command: 'duplicate' })).toBe(false);
  });
});
