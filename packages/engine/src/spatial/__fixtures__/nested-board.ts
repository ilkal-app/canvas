// The nested, rotated fixture board the spatial tests share:
//
//   frame "f" at (100, 100), rotated 90° (clockwise on screen), 100 × 100
//     shape "f-a" at (10, 0) in the frame, 10 × 10  -> world box x 90..100, y 110..120
//     group "g" at (50, 50) in the frame, rotated −90° (so upright in the world)
//       shape "g-b" at (0, 0) in the group, 20 × 10  -> world box x 50..70, y 150..160
//   shape "r" at the root, (300, 0), rotated 45°, 10 × 10 -> a diamond around x = 300
//   shape "far" at the root, (5000, 5000), 10 × 10
//
// Frame rotation 90°: a local point (u, v) maps to (100 − v, 100 + u).
import type { BoardObject } from '@canvas/schema';

import { frameObject, groupObject, shapeObject } from '../../scene/__fixtures__/scene-objects.js';

/**
 * Builds the fixture board.
 *
 * @returns Its objects, parents before children.
 */
export function nestedBoard(): BoardObject[] {
  return [
    frameObject('f', { x: 100, y: 100, rotation: Math.PI / 2 }),
    shapeObject('f-a', { parentId: 'f', x: 10, y: 0 }),
    groupObject('g', { parentId: 'f', x: 50, y: 50, rotation: -Math.PI / 2 }),
    shapeObject('g-b', { parentId: 'g', width: 20, height: 10 }),
    shapeObject('r', { x: 300, y: 0, rotation: Math.PI / 4 }),
    shapeObject('far', { x: 5000, y: 5000 }),
  ];
}
