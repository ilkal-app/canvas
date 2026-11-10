import type {
  FrameObject,
  FreehandObject,
  GroupObject,
  ImageObject,
  ObjectId,
  PathObject,
  StickyObject,
} from '@canvas/schema';

import { SHAPE, TEXT } from './popover-shape-connector-fixtures.js';

const BASE = {
  parentId: SHAPE.parentId,
  rotation: SHAPE.rotation,
  z: SHAPE.z,
  locked: SHAPE.locked,
  createdBy: SHAPE.createdBy,
  createdAt: SHAPE.createdAt,
  updatedAt: SHAPE.updatedAt,
  x: SHAPE.x,
  y: SHAPE.y,
};
const BOX = { ...BASE, width: SHAPE.width, height: SHAPE.height };

/** A section with a visible solid background. */
export const FRAME = {
  ...BOX,
  id: 'frame-1' as ObjectId,
  type: 'frame',
  name: 'Section',
  clip: false,
  background: [1, 0, 0, 1],
} as FrameObject;

/** Another section with no background. */
export const FRAME_2 = {
  ...FRAME,
  id: 'frame-2' as ObjectId,
  x: 420,
  background: null,
} as FrameObject;

/** An image with no link. */
export const IMAGE = {
  ...BOX,
  id: 'image-1' as ObjectId,
  type: 'image',
  assetId: 'asset-1',
  crop: { x: 0, y: 0, width: 1, height: 1 },
  naturalSize: { width: 100, height: 100 },
  opacity: 1,
} as ImageObject;

/** A second image for multi-image availability and link changes. */
export const IMAGE_2 = { ...IMAGE, id: 'image-2' as ObjectId, x: 420 } as ImageObject;

/** A coloured note for the mixed selection colour action. */
export const STICKY = {
  ...TEXT,
  id: 'sticky-1' as ObjectId,
  type: 'sticky',
  autoWidth: false,
  color: [1, 1, 0, 1],
} as StickyObject;

/** A vector network whose fill takes the mixed colour. */
export const PATH = {
  ...BASE,
  id: 'path-1' as ObjectId,
  type: 'path',
  vertices: [],
  segments: [],
  stroke: SHAPE.stroke,
  fill: null,
} as PathObject;

/** A freehand stroke whose width survives a mixed colour change. */
export const FREEHAND = {
  ...BASE,
  id: 'freehand-1' as ObjectId,
  type: 'freehand',
  tool: 'pencil',
  points: [0, 0, 20, 20],
  stroke: { color: [0, 0, 0, 1], width: 5 },
} as FreehandObject;

/** A non-colourable group for the mixed row. */
export const GROUP = { ...BASE, id: 'group-1' as ObjectId, type: 'group' } as GroupObject;
