// The link under a point with where its chip sits: a run link's span and the corner
// under its characters, the object's own link at the point, and no layout for an unlinked text.
import { describe, expect, it, vi } from 'vitest';

import { fontFaceId, fontFaceOf, layoutText, type GlyphMeasurer } from '@canvas/engine';
import type { BoardObject, ObjectId, PrincipalId, TextObject } from '@canvas/schema';
import { textOriginIn, type TextLayoutService } from '@canvas/tools';

import type { MountedEngine } from '../engine/mounted-engine.js';

import { linkHitAtPoint } from './link-at.js';

const LINK = 'https://example.com/run';
const STYLE = {
  fontFamily: 'Liberation Sans',
  fontSize: 10,
  color: [0, 0, 0, 1] as [number, number, number, number],
  weight: 400 as const,
  italic: false,
};
const MEASURER: GlyphMeasurer = {
  faceIdOf: (style) => fontFaceId(fontFaceOf(style)),
  advance: () => 0.6,
  kerning: () => 0,
  lineMetrics: () => ({ ascent: 0.8, descent: 0.2 }),
};
const TEXT: TextObject = {
  id: 't' as ObjectId,
  type: 'text',
  parentId: null,
  x: 100,
  y: 200,
  width: 30,
  height: 12.5,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:test' as PrincipalId,
  createdAt: 1,
  updatedAt: 1,
  text: 'a bc d',
  runs: [
    { length: 2, style: STYLE },
    { length: 2, style: { ...STYLE, link: LINK } },
    { length: 2, style: STYLE },
  ],
  align: 'left',
  autoWidth: true,
  verticalAlign: 'top',
};

/**
 * An engine at zoom 1 whose board finds `object` under every point.
 *
 * @param object - The object.
 * @returns The engine.
 */
function engineWith(object: BoardObject): MountedEngine {
  const get = (id: ObjectId): BoardObject | undefined => (id === object.id ? object : undefined);
  return {
    camera: () => ({ x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 }),
    board: { idsAt: () => [object.id], board: { get } },
  } as unknown as MountedEngine;
}

/** A canvas at the page's origin. */
const CANVAS = { getBoundingClientRect: () => ({ left: 0, top: 0 }) } as unknown as Element;

/**
 * Lays text out with the monospaced measurer, counting its calls.
 *
 * @returns The service and its call count.
 */
function layoutService(): TextLayoutService & { readonly calls: () => number } {
  const layout = vi.fn(({ text, runs }: { text: string; runs: TextObject['runs'] }) =>
    layoutText(text, runs, null, MEASURER),
  );
  return { layout, calls: () => layout.mock.calls.length } as unknown as TextLayoutService & {
    readonly calls: () => number;
  };
}

describe('linkHitAtPoint', () => {
  it("gives a run link's span and the corner under its characters on the point's line", () => {
    const service = layoutService();
    const hit = linkHitAtPoint(engineWith(TEXT), CANVAS, 114, 205, service);
    const layout = layoutText(TEXT.text, TEXT.runs, null, MEASURER);
    const origin = textOriginIn(TEXT, layout);
    const line = layout.lines[0];
    expect(hit).toEqual({
      objectId: TEXT.id,
      link: LINK,
      span: { start: 2, end: 4 },
      anchor: { x: 100 + origin.x + 12, y: 200 + origin.y + (line?.y ?? 0) + (line?.height ?? 0) },
    });
  });

  it('lays a linked text out once per version', () => {
    const service = layoutService();
    const engine = engineWith(TEXT);
    linkHitAtPoint(engine, CANVAS, 114, 205, service);
    linkHitAtPoint(engine, CANVAS, 115, 205, service);
    expect(service.calls()).toBe(1);
  });

  it("gives the object's own link at the point, off its run links", () => {
    const own = { ...TEXT, link: 'https://example.com/own' };
    expect(linkHitAtPoint(engineWith(own), CANVAS, 101, 205, layoutService())).toEqual({
      objectId: TEXT.id,
      link: 'https://example.com/own',
      anchor: { x: 101, y: 205 },
    });
  });

  it('never lays out a text without links', () => {
    const service = layoutService();
    const plain = { ...TEXT, runs: [{ length: 6, style: STYLE }] };
    expect(linkHitAtPoint(engineWith(plain), CANVAS, 114, 205, service)).toBeUndefined();
    expect(service.calls()).toBe(0);
  });

  it('turns the corner with a turned object', () => {
    const turned = { ...TEXT, rotation: Math.PI / 2 };
    const layout = layoutText(TEXT.text, TEXT.runs, null, MEASURER);
    const origin = textOriginIn(TEXT, layout);
    const line = layout.lines[0];
    // Local (x, y) maps to world (100 - y, 200 + x) a quarter turn clockwise.
    const local = { x: origin.x + 14, y: origin.y + (line?.y ?? 0) + 1 };
    const hit = linkHitAtPoint(
      engineWith(turned),
      CANVAS,
      100 - local.y,
      200 + local.x,
      layoutService(),
    );
    const corner = { x: origin.x + 12, y: origin.y + (line?.y ?? 0) + (line?.height ?? 0) };
    expect(hit?.anchor.x).toBeCloseTo(100 - corner.y);
    expect(hit?.anchor.y).toBeCloseTo(200 + corner.x);
  });
});
