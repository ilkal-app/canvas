import { describe, expect, it } from 'vitest';

import { INK_COLORS, type BoardObject, type ObjectId, type Rgba } from '@canvas/schema';

import {
  component,
  ComponentBoard,
  ExpansionHarness,
  frame,
  instance,
  shape,
} from '../components/__fixtures__/component-scene.js';
import { InstanceExpansion } from '../components/instance-expansion.js';
import { SDF_SHAPE_PASS, SDF_SHAPE_PASS_NAME } from '../shapes/shape-pass.js';

import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
  zKeyAt,
} from './__fixtures__/scene-objects.js';
import { FRAME_FILL_LUMINANCE } from './color-mode-fallback.js';
import { Scene } from './scene.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

// The frame-fill rule's incremental paths: a backdrop drawn in the viewer's ink colours
// follows them, and the rule follows an ancestor's mode cleared, a frame moved under a filled one
// and a main's frame refilled through a live instance.

const BLACK: Rgba = [0, 0, 0, 1];
const WHITE: Rgba = [1, 1, 1, 1];
const f32 = (color: readonly number[]) => Array.from(new Float32Array(color));
const OUTLINE = 13;

/**
 * A scene with the frame-fill rule over a fake document.
 *
 * @param options - More scene options.
 * @returns The scene, an apply step, an update step and readers of outlines and backgrounds.
 */
function setUp(options: ConstructorParameters<typeof Scene>[1] = {}) {
  const scene = new Scene([SOLID_RECT_PASS, SDF_SHAPE_PASS], {
    instanceBuffer: { maxGapBytes: 0 },
    colorModeFallback: FRAME_FILL_LUMINANCE,
    ...options,
  });
  const document = new FakeSceneDocument();
  const floats = (pass: string, id: string, offset: number): number[] => {
    const slot = scene.slotsOf(id as ObjectId, pass)[0] ?? -1;
    const buffer = scene.instanceBufferOf(pass);
    const at = slot * buffer.layout.floatsPerRecord + offset;
    return Array.from(buffer.data.subarray(at, at + 4));
  };
  return {
    scene,
    apply: (...objects: BoardObject[]) => {
      document.create(...objects);
      scene.apply(document.takeChanges());
    },
    update: (id: string, fields: Partial<BoardObject>) => {
      document.update(id, fields);
      scene.apply(document.takeChanges());
    },
    outline: (id: string) => floats(SDF_SHAPE_PASS_NAME, id, OUTLINE),
    background: (id: string) => floats('solid-rect', id, 6),
  };
}

const inked = (id: string, parentId: string | null, z: number) =>
  shapeObject(id, {
    stroke: { color: 'ink', width: 2 },
    parentId: parentId as ObjectId | null,
    z: zKeyAt(z),
  } as never);

const filled = (id: string, background: unknown, z: number, fields: object = {}) =>
  frameObject(id, { background: background as Rgba, z: zKeyAt(z), ...fields });

describe('a frame filled with the ink token', () => {
  it('is judged in the ink colours it is drawn in, and again when they change', () => {
    const { scene, apply, outline, background } = setUp();
    apply(filled('inked', { token: 'ink' }, 0), inked('child', 'inked', 1));
    // Light theme: the frame draws the dark light-mode ink, so its content is dark.
    expect(background('inked')).toEqual(f32(INK_COLORS.light));
    expect(outline('child')).toEqual(f32(INK_COLORS.dark));
    // The viewer's light-mode ink turns white: the frame is white, its content light.
    expect(scene.setInk(WHITE)).toBe(2);
    expect(background('inked')).toEqual(f32(WHITE));
    expect(outline('child')).toEqual(f32(WHITE));
  });

  it("follows a host's own ink colours from the start", () => {
    const { apply, outline, background } = setUp({ inkColors: { light: WHITE, dark: BLACK } });
    apply(filled('inked', { token: 'ink' }, 0), inked('child', 'inked', 1));
    expect(background('inked')).toEqual(f32(WHITE));
    expect(outline('child')).toEqual(f32(WHITE));
  });

  it("follows an edit of the board's ink token over the host's colours", () => {
    const { scene, apply, outline } = setUp({ inkColors: { light: WHITE, dark: BLACK } });
    apply(filled('inked', { token: 'ink' }, 0), inked('child', 'inked', 1));
    const grey: Rgba = [0.6, 0.6, 0.6, 1];
    // The frame turns black, so its content is dark and draws the edited dark-mode ink.
    expect(scene.setTokens(new Map([['ink', { light: BLACK, dark: grey }]]))).toBe(2);
    expect(outline('child')).toEqual(f32(grey));
  });
});

describe('the frame-fill rule under structural edits', () => {
  it("takes over when an ancestor's explicit mode is cleared", () => {
    const { apply, update, outline } = setUp();
    apply(
      filled('lit', null, 0, { colorMode: 'light' }),
      filled('night', BLACK, 1, { parentId: 'lit' }),
      inked('child', 'night', 2),
    );
    expect(outline('child')).toEqual(f32(INK_COLORS.light));
    update('lit', { colorMode: undefined });
    expect(outline('child')).toEqual(f32(INK_COLORS.dark));
  });

  it("re-resolves a frame's content when the frame moves under a filled one, and back", () => {
    const { apply, update, outline } = setUp();
    apply(filled('night', BLACK, 0), filled('bare', null, 1), inked('child', 'bare', 2));
    expect(outline('child')).toEqual(f32(INK_COLORS.light));
    update('bare', { parentId: 'night' as ObjectId });
    expect(outline('child')).toEqual(f32(INK_COLORS.dark));
    update('bare', { parentId: null });
    expect(outline('child')).toEqual(f32(INK_COLORS.light));
  });

  it("re-resolves a live instance's content when its main's frame is refilled", () => {
    const harness = new ExpansionHarness(
      new ComponentBoard(
        [
          component('main', { pageId: 'page-a' }),
          frame('panel', 'main', { background: WHITE }),
          shape('dot', 'panel', { stroke: { color: 'ink', width: 2 } }),
          instance('live', 'main', { pageId: 'page-b' }),
        ],
        'page-b',
      ),
      InstanceExpansion,
    );
    const scene = new Scene([SOLID_RECT_PASS, SDF_SHAPE_PASS], {
      colorModeFallback: FRAME_FILL_LUMINANCE,
    });
    let applied = 0;
    const step = (): void => {
      harness.step();
      for (const changes of harness.outputs.slice(applied)) scene.apply(changes);
      applied = harness.outputs.length;
    };
    const outline = (id: string): number[] => {
      const slot = scene.slotsOf(id as ObjectId, SDF_SHAPE_PASS_NAME)[0] ?? -1;
      const at = slot * SDF_SHAPE_PASS.layout.floatsPerRecord + OUTLINE;
      return Array.from(scene.instanceBufferOf(SDF_SHAPE_PASS_NAME).data.subarray(at, at + 4));
    };
    step();
    expect(outline('live/dot')).toEqual(f32(INK_COLORS.light));
    harness.board.update('panel', { background: BLACK });
    step();
    expect(outline('live/dot')).toEqual(f32(INK_COLORS.dark));
  });
});
