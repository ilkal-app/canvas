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
import { Scene } from './scene.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];
const GREEN: Rgba = [0, 1, 0, 1];
const BRAND = new Map([['brand', { light: RED, dark: BLUE }]]);
const f32 = (color: readonly number[]) => Array.from(new Float32Array(color));
const OUTLINE = 13;
const FILL = 4;

/**
 * A scene with the shape and solid-rect passes over a fake document, and readers of its records.
 *
 * @param options - The scene's colour options.
 * @returns The scene, its document and readers.
 */
function setUp(options: ConstructorParameters<typeof Scene>[1] = {}) {
  const scene = new Scene([SOLID_RECT_PASS, SDF_SHAPE_PASS], {
    instanceBuffer: { maxGapBytes: 0 },
    ...options,
  });
  const document = new FakeSceneDocument();
  const floatsAt = (passName: string, id: string, offset: number, record = 0): number[] => {
    const slot = scene.slotsOf(id as ObjectId, passName)[record] ?? -1;
    const floats = scene.instanceBufferOf(passName).layout.floatsPerRecord;
    const at = slot * floats + offset;
    return Array.from(scene.instanceBufferOf(passName).data.subarray(at, at + 4));
  };
  const apply = (...objects: BoardObject[]) => {
    document.create(...objects);
    scene.apply(document.takeChanges());
  };
  return {
    scene,
    document,
    apply,
    outline: (id: string) => floatsAt(SDF_SHAPE_PASS_NAME, id, OUTLINE),
    fill: (id: string, record = 0) => floatsAt(SDF_SHAPE_PASS_NAME, id, FILL, record),
    background: (id: string) => floatsAt('solid-rect', id, 6),
  };
}

const stroked = (id: string, color: unknown, fields: Partial<BoardObject> = {}) =>
  shapeObject(id, { stroke: { color: color as Rgba, width: 2 }, ...fields } as never);

describe('Scene colour tokens', () => {
  it('draws a token stroke, fill, sticky body and frame background in the resolved colour', () => {
    const { apply, outline, fill, background } = setUp({ colorTokens: BRAND });
    const sticky = {
      ...shapeObject('note'),
      type: 'sticky',
      color: { token: 'brand' },
      text: '',
      runs: [],
      autoSize: false,
    } as unknown as BoardObject;
    apply(
      stroked('stroke', { token: 'brand' }, { z: zKeyAt(0) }),
      shapeObject('filled', { fill: { token: 'surface' } as never, stroke: null, z: zKeyAt(1) }),
      frameObject('frame', { background: { token: 'brand' } as never, z: zKeyAt(2) }),
      { ...sticky, z: zKeyAt(3) },
    );
    expect(outline('stroke')).toEqual(f32(RED));
    expect(fill('filled')).toEqual(f32(BUILTIN_TOKEN_DEFAULTS.surface.light));
    expect(background('frame')).toEqual(f32(RED));
    expect(fill('note', 1)).toEqual(f32(RED));
  });

  it('draws a deleted or unknown token as ink, and follows an ink edit', () => {
    const { scene, apply, outline } = setUp();
    apply(stroked('lost', { token: 'gone' }));
    expect(outline('lost')).toEqual(f32(INK_COLORS.light));
    expect(scene.setTokens(new Map([['ink', { light: GREEN, dark: BLUE }]]))).toBe(1);
    expect(outline('lost')).toEqual(f32(GREEN));
  });

  it('rewrites only records naming a changed token, reading no document', () => {
    const { scene, document, apply, outline } = setUp({ colorTokens: BRAND });
    apply(
      stroked('brand', { token: 'brand' }, { z: zKeyAt(0) }),
      stroked('accent', { token: 'accent' }, { z: zKeyAt(1) }),
      stroked('plain', [0, 0, 0, 1], { z: zKeyAt(2) }),
    );
    const read = vi.spyOn(document, 'get');
    const accent = outline('accent');
    expect(scene.setTokens(new Map([['brand', { light: GREEN, dark: BLUE }]]))).toBe(1);
    expect(outline('brand')).toEqual(f32(GREEN));
    expect(outline('accent')).toEqual(accent);
    // An unchanged table, or a token nothing names, rewrites nothing.
    expect(scene.setTokens(new Map([['brand', { light: GREEN, dark: BLUE }]]))).toBe(0);
    expect(
      scene.setTokens(
        new Map([
          ['brand', { light: GREEN, dark: BLUE }],
          ['other', { light: RED, dark: RED }],
        ]),
      ),
    ).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });

  it('draws content in its frame’s mode, whatever the viewer’s theme, until the mode changes', () => {
    const { scene, document, apply, outline } = setUp({ colorTokens: BRAND });
    apply(
      frameObject('dark', { colorMode: 'dark', z: zKeyAt(0) } as never),
      stroked('inside', { token: 'brand' }, { parentId: 'dark' as ObjectId, z: zKeyAt(1) }),
      stroked('outside', { token: 'brand' }, { z: zKeyAt(2) }),
    );
    expect(outline('inside')).toEqual(f32(BLUE));
    expect(outline('outside')).toEqual(f32(RED));
    expect(scene.setTheme('dark')).toBe(1);
    expect(outline('outside')).toEqual(f32(BLUE));
    expect(scene.setTheme('light')).toBe(1);
    document.update('dark', { colorMode: 'light' } as never);
    scene.apply(document.takeChanges());
    expect(outline('inside')).toEqual(f32(RED));
    document.update('dark', { colorMode: undefined });
    scene.apply(document.takeChanges());
    expect(scene.setTheme('dark')).toBe(2);
  });

  it('takes a main’s mode for its content and an instance’s main’s for an instance', () => {
    const { apply, outline } = setUp({ colorTokens: BRAND });
    const main = { ...frameObject('main'), type: 'component', colorMode: 'dark', retired: false };
    apply(
      main as unknown as BoardObject,
      stroked('child', { token: 'brand' }, { parentId: 'main' as ObjectId }),
      {
        ...frameObject('inst'),
        type: 'instance',
        mainId: 'main',
        overrides: {},
      } as unknown as BoardObject,
      stroked('inst/child', { token: 'brand' }, { parentId: 'inst' as ObjectId }),
    );
    expect(outline('child')).toEqual(f32(BLUE));
    expect(outline('inst/child')).toEqual(f32(BLUE));
  });

  it('asks the fallback hook before the viewer’s theme, never past an explicit mode', () => {
    const fallback = vi.fn((object: BoardObject) => (object.id === 'hooked' ? 'dark' : undefined));
    const { scene, apply, outline } = setUp({ colorTokens: BRAND, colorModeFallback: fallback });
    apply(
      frameObject('light', { colorMode: 'light' } as never),
      stroked('hooked', { token: 'brand' }),
      stroked('framed', { token: 'brand' }, { parentId: 'light' as ObjectId }),
    );
    expect(outline('hooked')).toEqual(f32(BLUE));
    expect(outline('framed')).toEqual(f32(RED));
    expect(fallback.mock.calls.map(([object]) => object.id)).toEqual(['hooked']);
    // A fixed mode is not the viewer's: a theme switch leaves both.
    expect(scene.setTheme('dark')).toBe(0);
  });

  it('keeps a record’s slot and its literal ink apart from ink token refs on a theme switch', () => {
    const { scene, apply, outline } = setUp();
    apply(
      stroked('literal', 'ink', { z: zKeyAt(0) }),
      stroked('ref', { token: 'ink' }, { z: zKeyAt(1) }),
    );
    expect(outline('literal')).toEqual(outline('ref'));
    expect(scene.setTheme('dark')).toBe(2);
    expect(outline('literal')).toEqual(f32(INK_COLORS.dark));
    expect(outline('ref')).toEqual(f32(INK_COLORS.dark));
  });
});
