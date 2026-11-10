import { describe, expect, it, vi } from 'vitest';

import {
  BUILTIN_TOKEN_DEFAULTS,
  INK_COLORS,
  type BoardObject,
  type ObjectId,
  type Rgba,
} from '@canvas/schema';

import { SDF_SHAPE_PASS, SDF_SHAPE_PASS_NAME } from '../shapes/shape-pass.js';

import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
  zKeyAt,
} from './__fixtures__/scene-objects.js';
import {
  FRAME_FILL_LUMINANCE,
  frameFillFallbackMode,
  isFrameFillFallback,
} from './color-mode-fallback.js';
import { Scene } from './scene.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

const BLACK: Rgba = [0, 0, 0, 1];
const WHITE: Rgba = [1, 1, 1, 1];
const f32 = (color: readonly number[]) => Array.from(new Float32Array(color));
const DARK_INK = f32(INK_COLORS.light);
const LIGHT_INK = f32(INK_COLORS.dark);
const OUTLINE = 13;

/**
 * A scene with the frame-fill fallback over a fake document, and a reader of shape outlines.
 *
 * @param options - More scene options.
 * @returns The scene, its document, an apply step and the outline reader.
 */
function setUp(options: ConstructorParameters<typeof Scene>[1] = {}) {
  const scene = new Scene([SOLID_RECT_PASS, SDF_SHAPE_PASS], {
    instanceBuffer: { maxGapBytes: 0 },
    colorModeFallback: FRAME_FILL_LUMINANCE,
    ...options,
  });
  const document = new FakeSceneDocument();
  const outline = (id: string): number[] => {
    const slot = scene.slotsOf(id as ObjectId, SDF_SHAPE_PASS_NAME)[0] ?? -1;
    const buffer = scene.instanceBufferOf(SDF_SHAPE_PASS_NAME);
    const at = slot * buffer.layout.floatsPerRecord + OUTLINE;
    return Array.from(buffer.data.subarray(at, at + 4));
  };
  const apply = (...objects: BoardObject[]) => {
    document.create(...objects);
    return scene.apply(document.takeChanges());
  };
  const update = (id: string, fields: Partial<BoardObject>) => {
    document.update(id, fields);
    return scene.apply(document.takeChanges());
  };
  return { scene, document, apply, update, outline };
}

const inked = (id: string, parentId: string | null, z: number) =>
  shapeObject(id, {
    stroke: { color: 'ink', width: 2 },
    parentId: parentId as ObjectId | null,
    z: zKeyAt(z),
  } as never);

const filled = (id: string, background: unknown, z: number, fields: object = {}) =>
  frameObject(id, { background: background as Rgba, z: zKeyAt(z), ...fields });

describe('the frame-fill fallback in a scene', () => {
  it('draws ink light on a dark frame and dark on a light one, in either viewer theme', () => {
    const { scene, apply, outline } = setUp();
    apply(
      filled('night', BLACK, 0),
      inked('onNight', 'night', 1),
      filled('card', WHITE, 2, { parentId: 'night' }),
      inked('onCard', 'card', 3),
      inked('loose', null, 4),
    );
    expect(outline('onNight')).toEqual(LIGHT_INK);
    expect(outline('onCard')).toEqual(DARK_INK);
    expect(outline('loose')).toEqual(DARK_INK);
    // Only the object on no filled frame follows the viewer.
    expect(scene.setTheme('dark')).toBe(1);
    expect(outline('onNight')).toEqual(LIGHT_INK);
    expect(outline('onCard')).toEqual(DARK_INK);
    expect(outline('loose')).toEqual(LIGHT_INK);
  });

  it("re-resolves a frame's content when its fill changes, and on a reparent in or out", () => {
    const { apply, update, outline } = setUp();
    apply(filled('frame', WHITE, 0), inked('inside', 'frame', 1), filled('night', BLACK, 2));
    expect(outline('inside')).toEqual(DARK_INK);
    update('frame', { background: [0.1, 0.1, 0.3, 1] } as never);
    expect(outline('inside')).toEqual(LIGHT_INK);
    update('frame', { background: null });
    expect(outline('inside')).toEqual(DARK_INK);
    update('inside', { parentId: 'night' as ObjectId });
    expect(outline('inside')).toEqual(LIGHT_INK);
    update('inside', { parentId: null });
    expect(outline('inside')).toEqual(DARK_INK);
  });

  it('never passes an explicit colour mode', () => {
    const { apply, outline } = setUp();
    apply(
      filled('lit', [0.9, 0.9, 0.9, 1], 0, { colorMode: 'light' }),
      filled('night', BLACK, 1, { parentId: 'lit' }),
      inked('held', 'night', 2),
    );
    expect(outline('held')).toEqual(DARK_INK);
  });

  it('follows a token fill through a token edit and a theme switch, reading no document', () => {
    const brand = new Map([['brand', { light: WHITE, dark: WHITE }]]);
    const { scene, document, apply, outline } = setUp({ colorTokens: brand });
    apply(
      filled('branded', { token: 'brand' }, 0),
      inked('onBrand', 'branded', 1),
      filled('surface', { token: 'surface' }, 2),
      inked('onSurface', 'surface', 3),
      filled('night', BLACK, 4),
      filled('inner', { token: 'surface' }, 5, { parentId: 'night' }),
      inked('onInner', 'inner', 6),
    );
    const read = vi.spyOn(document, 'get');
    expect(outline('onBrand')).toEqual(DARK_INK);
    expect(outline('onSurface')).toEqual(DARK_INK);
    // The inner surface is its dark value under the black frame: dark, whatever the theme.
    expect(outline('onInner')).toEqual(LIGHT_INK);
    // The frame (its own fill names the token) and the ink on it.
    expect(scene.setTokens(new Map([['brand', { light: BLACK, dark: BLACK }]]))).toBe(2);
    expect(outline('onBrand')).toEqual(LIGHT_INK);
    // A token nothing's fill names moves nothing.
    expect(
      scene.setTokens(
        new Map([
          ['brand', { light: BLACK, dark: BLACK }],
          ['x', { light: WHITE, dark: WHITE }],
        ]),
      ),
    ).toBe(0);
    // The surface frame's own mode is the viewer's, so its fill turns dark with the theme.
    expect(BUILTIN_TOKEN_DEFAULTS.surface.dark[0]).toBeLessThan(0.2);
    // The surface frame and the ink on it; the inner pair keeps the black frame's mode.
    expect(scene.setTheme('dark')).toBe(2);
    expect(outline('onSurface')).toEqual(LIGHT_INK);
    expect(outline('onInner')).toEqual(LIGHT_INK);
    expect(scene.setTheme('light')).toBe(2);
    expect(outline('onSurface')).toEqual(DARK_INK);
    expect(read).not.toHaveBeenCalled();
  });

  it("walks virtual content to its instance's frame", () => {
    const { apply, outline } = setUp();
    apply(
      filled('night', BLACK, 0),
      {
        ...frameObject('inst'),
        type: 'instance',
        mainId: 'main',
        overrides: {},
        parentId: 'night',
        z: zKeyAt(1),
      } as unknown as BoardObject,
      filled('inst/panel', WHITE, 2, { parentId: 'inst' }),
      inked('inst/onPanel', 'inst/panel', 3),
      inked('inst/edge', 'inst', 4),
    );
    expect(outline('inst/onPanel')).toEqual(DARK_INK);
    expect(outline('inst/edge')).toEqual(LIGHT_INK);
  });

  it('ignores a fallback name it does not know', () => {
    const { apply, outline } = setUp({ colorModeFallback: 'frame-fill' as never });
    apply(filled('night', BLACK, 0), inked('onNight', 'night', 1));
    expect(outline('onNight')).toEqual(DARK_INK);
  });
});

describe('frameFillFallbackMode', () => {
  it('keeps the fills only when a token fill was read', () => {
    expect(frameFillFallbackMode([BLACK], 'light', new Map(), INK_COLORS)).toEqual({
      mode: 'dark',
    });
    expect(
      frameFillFallbackMode([null, { token: 'surface' }], 'dark', new Map(), INK_COLORS),
    ).toEqual({
      mode: 'dark',
      backdrop: {
        fills: [null, { token: 'surface' }],
        didReadViewerTheme: true,
        tokens: new Set(['surface']),
      },
    });
  });

  it('names one built-in', () => {
    expect(isFrameFillFallback('frame-fill-luminance')).toBe(true);
    expect(isFrameFillFallback(() => 'dark')).toBe(false);
    expect(isFrameFillFallback(undefined)).toBe(false);
  });
});
