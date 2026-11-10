import { describe, expect, it } from 'vitest';

import { newShapeObject } from './new-shape-object.js';
import * as shapeApi from './shape-api.js';
import { ShapeMode } from './shape-mode.js';

describe('the shape area’s API', () => {
  it('re-exports the shape tool’s mode and geometry as they are', () => {
    expect(shapeApi.ShapeMode).toBe(ShapeMode);
    expect(shapeApi.newShapeObject).toBe(newShapeObject);
    expect(typeof shapeApi.shapeDragBox).toBe('function');
  });
});
