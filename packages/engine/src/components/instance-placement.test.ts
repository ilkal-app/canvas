import { describe, expect, it } from 'vitest';

import {
  cardMain,
  ComponentBoard,
  ExpansionHarness,
  instance,
} from './__fixtures__/component-scene.js';
import { InstanceExpansion } from './instance-expansion.js';

describe('instance placement after decoding', () => {
  it('keeps virtual geometry when decoding rebuilds equal override records', () => {
    const board = new ComponentBoard([
      ...cardMain(),
      instance('inst', 'main', {
        overrides: { title: { fill: [1, 0, 0, 1] }, note: { text: 'Same' } },
      }),
    ]);
    const harness = new ExpansionHarness(board, InstanceExpansion);
    harness.step();
    const before = harness.outputs.length;
    board.resetReads();
    board.update('inst', {
      x: 700,
      overrides: {
        note: { text: 'Same' },
        title: { fill: [1, 0, 0, 1] },
      },
    });
    harness.step();
    expect([...harness.listedSince(before)]).toEqual(['inst']);
    expect(board.reads).toEqual([]);
    harness.expectScene();
    board.update('inst', { overrides: { title: { fill: [0, 1, 0, 1] } } });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('inst/title')).toMatchObject({ fill: [0, 1, 0, 1] });
  });
});
