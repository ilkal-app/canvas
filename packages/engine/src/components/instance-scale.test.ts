// Instance content scale in the engine: an instance draws its main's content `scale`
// times larger, so a rescale re-resolves it, a child edit still patches its scaled copy, and a
// copy past the stored ranges (a 20× stroke) is drawn. Each step's scene equals the oracle's full
// resolution.
import { describe, expect, it } from 'vitest';

import {
  cardMain,
  ComponentBoard,
  ExpansionHarness,
  instance,
} from './__fixtures__/component-scene.js';
import { expectedExport } from './__fixtures__/expected-api.js';

/**
 * The card main and an instance of it at `scale`, shown.
 *
 * @param scale - The instance's content scale.
 * @returns The harness, attached.
 * @throws {Error} When the card fixture has no main.
 */
function scaledBoard(scale: number): ExpansionHarness {
  const [main, ...children] = cardMain();
  if (main?.type !== 'component') throw new Error('no card main');
  const objects = [
    main,
    ...children,
    instance('big', 'main', {
      x: 400,
      width: main.width * scale,
      height: main.height * scale,
      scale,
    }),
  ];
  const harness = new ExpansionHarness(
    new ComponentBoard(objects),
    expectedExport('InstanceExpansion'),
  );
  harness.step();
  return harness;
}

describe('InstanceExpansion with a content scale', () => {
  it('draws each copy scale times larger', () => {
    const harness = scaledBoard(2);
    harness.expectScene();
    expect(harness.mirror.get('big/title')).toMatchObject({ x: 20, y: 20, width: 360, height: 40 });
  });

  it('re-resolves an instance whose scale changes', () => {
    const harness = scaledBoard(2);
    harness.board.update('big', { scale: 0.5 });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('big/title')).toMatchObject({ x: 5, width: 90 });
  });

  it('patches a child edit into the scaled copy', () => {
    const harness = scaledBoard(2);
    harness.board.update('title', { width: 150 });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('big/title')).toMatchObject({ width: 300 });
  });
});
