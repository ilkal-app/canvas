import { describe, expect, it } from 'vitest';

import { leftOutNotice } from './left-out-notice.js';

describe('leftOutNotice', () => {
  it('says how many objects stayed, one or several', () => {
    expect(leftOutNotice(1)).toMatch(/^1 object was left where it was/);
    expect(leftOutNotice(3)).toMatch(/^3 objects were left where they were/);
  });
});
