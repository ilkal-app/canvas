import type { BoardObject, StickyObject, TextObject } from '@canvas/schema';
import { textPlacementOf as placementWith, type TextBoxGeometry } from '@canvas/text';

import { connectorShapeOf } from '../../connectors/connector-shape.js';

// The placement lives in @canvas/text, which places text without the engine too; the
// engine adds only a connector's route, which finds where its label is centred.
export { textOriginOf } from '@canvas/text';
export type { TextBoxGeometry, TextVerticalAlign } from '@canvas/text';

/**
 * The text box an object draws, if any (`textPlacementOf` of `@canvas/text`), a connector's
 * label centred on the point halfway along its route (`connectorShapeOf`). Pure.
 *
 * @param object - The object.
 * @returns The box, or `undefined` when the object draws no text; a text object's or a sticky
 *   note's always exists.
 */
export function textPlacementOf(object: TextObject | StickyObject): TextBoxGeometry;
export function textPlacementOf(object: BoardObject): TextBoxGeometry | undefined;
export function textPlacementOf(object: BoardObject): TextBoxGeometry | undefined {
  return placementWith(object, (connector) => connectorShapeOf(connector).label);
}
