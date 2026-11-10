import { describe, expect, it } from 'vitest';

import { selectAll } from './editor-navigation.js';
import { insertText } from './editor.js';
import * as textApi from './text-api.js';

describe('the text area’s API', () => {
  it('re-exports the editor’s operations as they are', () => {
    expect(textApi.insertText).toBe(insertText);
    expect(textApi.selectAll).toBe(selectAll);
    expect(Object.keys(textApi).length).toBeGreaterThan(20);
  });
});
