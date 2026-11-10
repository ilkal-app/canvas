import { describe, expect, it } from 'vitest';

import { NOT_AVAILABLE_YET, notAvailableName } from './not-available.js';

describe('notAvailableName', () => {
  it('says the control’s name, a dash and that it is not available yet', () => {
    expect(NOT_AVAILABLE_YET).toBe('not available yet');
    expect(notAvailableName('Pen')).toBe('Pen — not available yet');
  });
});
