// A main's own placement and name are not read by resolution, so editing them lists no
// virtual id; its size, retirement and content still re-resolve every instance.
import { describe, expect, it } from 'vitest';

import {
  cardMain,
  component,
  ComponentBoard,
  ExpansionHarness,
  instance,
  shape,
} from './__fixtures__/component-scene.js';
import { InstanceExpansion } from './instance-expansion.js';

/** A board stepped through an expansion harness. */
interface Fixture {
  readonly board: ComponentBoard;
  readonly harness: ExpansionHarness;
}

/**
 * Builds a stepped harness over the card main and some instances of it.
 *
 * @param count - How many instances to place.
 * @returns The board and its harness, after the first step.
 */
function cards(count: number): Fixture {
  const instances = Array.from({ length: count }, (unused, i) =>
    instance(`inst-${String(i)}`, 'main', { x: 400 + i * 300 }),
  );
  const board = new ComponentBoard([...cardMain(), ...instances]);
  const harness = new ExpansionHarness(board, InstanceExpansion);
  harness.step();
  return { board, harness };
}

/**
 * Applies one edit and lists the virtual ids the expansion emitted for it.
 *
 * @param fixture - The stepped board and harness.
 * @param edit - The edit to apply.
 * @returns The virtual ids listed and the definition reads made.
 */
function virtualListed(
  fixture: Fixture,
  edit: (board: ComponentBoard) => void,
): { ids: string[]; reads: number } {
  const from = fixture.harness.outputs.length;
  fixture.board.resetReads();
  edit(fixture.board);
  fixture.harness.step();
  fixture.harness.expectScene();
  const ids = [...fixture.harness.listedSince(from)].filter((id) => id.includes('/'));
  return { ids, reads: fixture.board.reads.length };
}

describe('editing a main itself', () => {
  it.each([
    ['moving', { x: 5_000, y: 5_000 }],
    ['rotating', { rotation: 0.5 }],
    ['restacking', { z: 'zz' }],
    ['renaming', { name: 'Renamed card' }],
  ])('%s the main re-resolves no instance', (edit, fields) => {
    for (const count of [1, 50]) {
      const fixture = cards(count);
      expect(
        virtualListed(fixture, (board) => {
          board.update('main', fields);
        }).ids,
      ).toEqual([]);
    }
  });

  it('reads as much for 50 instances as for 1 when the main moves', () => {
    const one = virtualListed(cards(1), (board) => {
      board.update('main', { x: 9 });
    });
    const fifty = virtualListed(cards(50), (board) => {
      board.update('main', { x: 9 });
    });
    expect(fifty.reads).toBe(one.reads);
  });

  it('re-resolves every instance when the main is resized', () => {
    const fixture = cards(3);
    fixture.board.update('photo', { constraints: { x: 'end', y: 'center' } });
    fixture.harness.step();
    const { ids } = virtualListed(fixture, (board) => {
      board.update('main', { width: 600 });
    });
    expect(new Set(ids.map((id) => id.split('/')[0]))).toEqual(
      new Set(['inst-0', 'inst-1', 'inst-2']),
    );
  });

  it('re-resolves every instance when a child is added to a main that did not move', () => {
    const fixture = cards(2);
    const { ids } = virtualListed(fixture, (board) => {
      board.add(shape('extra', 'main'));
    });
    expect(ids).toEqual(expect.arrayContaining(['inst-0/extra', 'inst-1/extra']));
  });

  it('re-resolves when a moved main is also resized in the same step', () => {
    const fixture = cards(1);
    fixture.board.update('photo', { constraints: { x: 'end', y: 'center' } });
    fixture.harness.step();
    const { ids } = virtualListed(fixture, (board) => {
      board.update('main', { x: 77, width: 640 });
    });
    expect(ids.length).toBeGreaterThan(0);
  });

  it("lists only the edited child's copies when one child of the main changes", () => {
    const fixture = cards(50);
    const { ids } = virtualListed(fixture, (board) => {
      board.update('title', { fill: [0.9, 0.1, 0.1, 1] });
    });
    expect(ids).toHaveLength(50);
    expect(ids.every((id) => id.endsWith('/title'))).toBe(true);
  });

  it('re-resolves an outer instance when a nested main inside its main moves', () => {
    const board = new ComponentBoard([
      component('outer', { width: 800, height: 400 }),
      component('inner', { parentId: 'outer', x: 10, y: 10, width: 100, height: 100 }),
      shape('dot', 'inner'),
      instance('outer-inst', 'outer', { x: 2_000 }),
    ]);
    const harness = new ExpansionHarness(board, InstanceExpansion);
    harness.step();
    const { ids } = virtualListed({ board, harness }, (b) => {
      b.update('inner', { x: 300 });
    });
    expect(ids).toContain('outer-inst/inner');
  });
});

describe('the scene ancestry index', () => {
  it('forgets parents once their last child leaves', () => {
    const board = new ComponentBoard([...cardMain(), instance('inst', 'main')]);
    const harness = new ExpansionHarness(board, InstanceExpansion);
    harness.step();
    const shown = (harness.expansion as unknown as { shown: { children: Map<string, unknown> } })
      .shown;
    const parents = shown.children.size;
    for (let i = 0; i < 20; i += 1) {
      board.add(component(`g${String(i)}`), shape(`s${String(i)}`, `g${String(i)}`));
      harness.step();
      board.remove(`s${String(i)}`, `g${String(i)}`);
      harness.step();
    }
    expect(shown.children.size).toBe(parents);
  });
});
