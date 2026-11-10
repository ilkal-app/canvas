import { describe, expect, it } from 'vitest';

import { strandedEditsMessage } from './stranded-edits-message.js';

describe('strandedEditsMessage', () => {
  it('names the board, the count, both layouts and what dismissing does', () => {
    const edits = {
      boardId: 'b-1',
      source: 'canvas-board-cache:layout:1',
      fromLayoutVersion: 2,
      toLayoutVersion: 3,
      unsentChangeCount: 4,
    };
    expect(strandedEditsMessage(edits, 'Roadmap')).toBe(
      '4 unsent changes to “Roadmap” were made in an older version of the app (stored layout 2) ' +
        'and could not be carried over to this version (stored layout 3). They are kept on this ' +
        'device until you dismiss this notice, which deletes them.',
    );
  });

  it('speaks of one change in the singular', () => {
    const edits = {
      boardId: 'b-1',
      source: 'canvas-board-cache:layout:1',
      fromLayoutVersion: 1,
      toLayoutVersion: 2,
      unsentChangeCount: 1,
    };
    expect(strandedEditsMessage(edits, 'demo')).toBe(
      '1 unsent change to “demo” was made in an older version of the app (stored layout 1) and ' +
        'could not be carried over to this version (stored layout 2). It is kept on this device ' +
        'until you dismiss this notice, which deletes it.',
    );
  });
});
