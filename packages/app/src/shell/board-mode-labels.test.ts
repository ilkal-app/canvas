import { describe, expect, it } from 'vitest';

import { BOARD_MODES } from '@canvas/schema';

import { BOARD_MODE_LABELS } from './board-mode-labels.js';

describe('BOARD_MODE_LABELS', () => {
  it('names every board mode by its product, diagrams as part of Boards', () => {
    expect(BOARD_MODES.map((mode) => BOARD_MODE_LABELS[mode])).toEqual([
      'Boards',
      'Design',
      'Boards',
      'Draw',
      'Motion',
      'Slides',
    ]);
  });
});
