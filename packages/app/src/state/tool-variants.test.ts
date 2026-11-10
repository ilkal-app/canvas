import { describe, expect, it } from 'vitest';

import {
  ARROW_VARIANT,
  CONNECTOR_VARIANT,
  ELBOW_CONNECTOR_VARIANT,
  ELLIPSE_VARIANT,
  LINE_VARIANT,
  POLYGON_VARIANT,
  SHAPE_KIND_LABELS,
  SHAPE_VARIANTS,
  toolButtonOf,
  toolVariantAction,
  toolVariantOf,
  TRIANGLE_VARIANT,
} from './tool-variants.js';

describe('tool variants', () => {
  it('puts the line tool in its arrow only while its style ends in an arrow', () => {
    expect(toolVariantOf('line', {})).toBe(LINE_VARIANT);
    expect(toolVariantOf('line', { line: { endCap: 'none' } })).toBe(LINE_VARIANT);
    expect(toolVariantOf('line', { line: { endCap: 'arrow' } })).toBe(ARROW_VARIANT);
    expect(toolVariantOf('line', { line: { endCap: 'triangle' } })).toBe(LINE_VARIANT);
    expect(toolVariantOf('text', { line: { endCap: 'arrow' } })).toBeUndefined();
  });

  it('chooses a variant by making its tool active with its style fields', () => {
    expect(toolVariantAction(ARROW_VARIANT)).toEqual({
      type: 'selectTool',
      tool: 'line',
      style: { endCap: 'arrow' },
    });
    expect(toolVariantAction(LINE_VARIANT)).toEqual({
      type: 'selectTool',
      tool: 'line',
      style: { endCap: 'none' },
      replaces: { endCap: 'arrow' },
    });
  });

  it('names a tool’s button for its variant, and a plain tool for itself', () => {
    expect(toolButtonOf('line', { line: { endCap: 'arrow' } })).toEqual({
      label: 'Arrow',
      name: 'Line: Arrow',
      action: toolVariantAction(ARROW_VARIANT),
    });
    expect(toolButtonOf('line', { line: { endCap: 'diamond' } })).toMatchObject({
      label: 'Line',
      name: 'Line',
    });
    expect(toolButtonOf('pen', {})).toEqual({
      label: 'Pen',
      name: 'Pen',
      action: { type: 'selectTool', tool: 'pen' },
    });
  });

  it("puts the shape tool in its kind's variant, a rectangle until another is picked", () => {
    expect(toolVariantOf('shape', {})).toBe(SHAPE_VARIANTS.rectangle);
    expect(toolVariantOf('shape', { shape: { kind: 'star' } })).toBe(SHAPE_VARIANTS.star);
    expect(SHAPE_VARIANTS.diamond).toEqual({
      tool: 'shape',
      label: SHAPE_KIND_LABELS.diamond,
      style: { kind: 'diamond' },
      isPickedInPanel: true,
    });
  });

  it("names the shape tool's button for its kind; a click chooses that kind again, as its key does", () => {
    // R and O pick the rectangle and the ellipse, so a kind's button chooses its preset;
    // a kind picked only in the panel (the diamond) is still chosen plainly, keeping it.
    expect(toolButtonOf('shape', { shape: { kind: 'ellipse' } })).toEqual({
      label: 'Ellipse',
      name: 'Shape: Ellipse',
      action: toolVariantAction(ELLIPSE_VARIANT),
    });
    expect(toolButtonOf('shape', { shape: { kind: 'diamond' } })).toEqual({
      label: 'Diamond',
      name: 'Shape: Diamond',
      action: { type: 'selectTool', tool: 'shape' },
    });
  });

  it('puts a three-sided polygon in the triangle, and any other count in the polygon', () => {
    expect(toolVariantOf('shape', { shape: { kind: 'polygon', sides: 3 } })).toBe(TRIANGLE_VARIANT);
    expect(toolVariantOf('shape', { shape: { kind: 'polygon', sides: 6 } })).toBe(POLYGON_VARIANT);
    expect(toolVariantOf('shape', { shape: { kind: 'polygon' } })).toBe(POLYGON_VARIANT);
    expect(TRIANGLE_VARIANT.style).toEqual({ kind: 'polygon', sides: 3 });
  });

  it('puts the connector in its elbow while its route is elbow, else in the connector', () => {
    expect(toolVariantOf('connector', {})).toBe(CONNECTOR_VARIANT);
    expect(toolVariantOf('connector', { connector: { route: 'curved' } })).toBe(CONNECTOR_VARIANT);
    expect(toolVariantOf('connector', { connector: { route: 'elbow' } })).toBe(
      ELBOW_CONNECTOR_VARIANT,
    );
    expect(toolVariantAction(CONNECTOR_VARIANT)).toEqual({
      type: 'selectTool',
      tool: 'connector',
      style: { route: 'straight' },
      replaces: { route: 'elbow' },
    });
  });
});
