// The engine must gather effective slot mains as well as stored definitions.
import { describe, expect, it } from 'vitest';

import {
  component,
  ComponentBoard,
  ExpansionHarness,
  instance,
  shape,
} from './__fixtures__/component-scene.js';
import { expectedExport } from './__fixtures__/expected-api.js';

const RED = [1, 0, 0, 1] as const;
const BLUE = [0, 0, 1, 1] as const;

function swapBoard(): ExpansionHarness {
  const objects = [
    component('button'),
    instance('slot', 'icon-a', { parentId: 'button', x: 12, y: 12, width: 20, height: 20 }),
    component('icon-a'),
    shape('a-mark', 'icon-a', { fill: RED }),
    component('icon-b'),
    shape('b-mark', 'icon-b', { fill: BLUE }),
    instance('swapped', 'button', { x: 300, overrides: { slot: { mainId: 'icon-b' } } }),
    instance('plain', 'button', { x: 600 }),
  ];
  const harness = new ExpansionHarness(
    new ComponentBoard(objects),
    expectedExport('InstanceExpansion'),
  );
  harness.step();
  return harness;
}

describe('InstanceExpansion: swapped nested main', () => {
  it('renders the swapped icon under its slot path while another instance keeps the stored icon', () => {
    const harness = swapBoard();
    expect(harness.mirror.get('swapped/slot/b-mark')).toMatchObject({ fill: BLUE });
    expect(harness.mirror.has('swapped/slot/a-mark')).toBe(false);
    expect(harness.mirror.get('plain/slot/a-mark')).toMatchObject({ fill: RED });
    harness.expectScene();
  });

  it('propagates a swapped main child edit and addition only to instances that use it', () => {
    const harness = swapBoard();
    const before = harness.outputs.length;
    harness.board.update('b-mark', { fill: RED });
    harness.board.add(shape('b-extra', 'icon-b', { x: 8, y: 8 }));
    harness.step();
    expect(harness.mirror.get('swapped/slot/b-mark')).toMatchObject({ fill: RED });
    harness.expectScene();
    expect(harness.mirror.has('swapped/slot/b-extra')).toBe(true);
    expect([...harness.listedSince(before)].filter((id) => id.startsWith('plain/'))).toEqual([]);
  });

  it('follows a swap record being added, changed and removed', () => {
    const harness = swapBoard();
    harness.board.update('plain', { overrides: { slot: { mainId: 'icon-b' } } });
    harness.step();
    expect(harness.mirror.has('plain/slot/b-mark')).toBe(true);
    harness.expectScene();
    harness.board.update('swapped', { overrides: {} });
    harness.step();
    expect(harness.mirror.has('swapped/slot/a-mark')).toBe(true);
    harness.expectScene();
    harness.board.update('plain', { overrides: { slot: { mainId: 'icon-a' } } });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.has('plain/slot/a-mark')).toBe(true);
  });

  it('falls back on retirement and deletion, then restores the saved swap', () => {
    const harness = swapBoard();
    harness.board.update('icon-b', { retired: true });
    harness.step();
    expect(harness.mirror.has('swapped/slot/a-mark')).toBe(true);
    harness.expectScene();
    harness.board.update('icon-b', { retired: false });
    harness.step();
    expect(harness.mirror.has('swapped/slot/b-mark')).toBe(true);
    harness.expectScene();
    const saved = harness.board.objects.get('icon-b' as never);
    if (saved === undefined) throw new Error('fixture');
    harness.board.remove('icon-b');
    harness.step();
    expect(harness.mirror.has('swapped/slot/a-mark')).toBe(true);
    harness.expectScene();
    harness.board.add(saved);
    harness.step();
    expect(harness.mirror.has('swapped/slot/b-mark')).toBe(true);
    harness.expectScene();
  });

  it('follows the selected variant preset swap and its edits', () => {
    const harness = swapBoard();
    harness.board.update('button', {
      variantAxes: [{ name: 'state', values: ['rest', 'active'] }],
      variantPresets: { 'state=rest': {}, 'state=active': { slot: { mainId: 'icon-b' } } },
    });
    harness.board.update('swapped', { overrides: {}, variant: { state: 'active' } });
    harness.step();
    expect(harness.mirror.has('swapped/slot/b-mark')).toBe(true);
    harness.expectScene();
    expect(harness.mirror.has('plain/slot/a-mark')).toBe(true);
    harness.board.update('b-mark', { fill: RED });
    harness.step();
    expect(harness.mirror.get('swapped/slot/b-mark')).toMatchObject({ fill: RED });
    harness.expectScene();
    harness.board.update('swapped', { variant: { state: 'rest' } });
    harness.step();
    expect(harness.mirror.has('swapped/slot/a-mark')).toBe(true);
    harness.expectScene();
  });
});
