import type {
  ConnectorObject,
  LineCap,
  ObjectId,
  Point,
  Stroke,
  StrokeStyle,
} from '@canvas/schema';

import type { LineToolContext } from '../line/line-context.js';
import type { SelectionSource } from '../select/selection-geometry.js';

/** The style the connector tool gives a new connector: its stroke, its caps and its route. */
export interface ConnectorStyle extends StrokeStyle {
  /** The stroke's colour and width. */
  readonly stroke: Stroke;
  /** The cap at the connector's start. */
  readonly startCap: LineCap;
  /** The cap at its end. */
  readonly endCap: LineCap;
  /** Straight, elbow or curved. */
  readonly route: ConnectorObject['route'];
}

/**
 * What the connector tool works on and reports to: a line tool's
 * context (the document, previews, the undo capture, the snap index and refusals) with the
 * document as the select tool reads it, the tool's style, what lies under the pointer, and the
 * callbacks that select the new connector and leave the tool. The app's engine document gives it
 * from the tool modes' services. Main thread.
 */
export interface ConnectorModeContext extends LineToolContext {
  /** The document the ends attach and snap against (the select tool's source). */
  readonly source: SelectionSource;
  /** The connector tool's style now: its defaults with the person's choices. */
  readonly connectorStyle: () => ConnectorStyle;
  /**
   * The topmost object under a point that a connector end attaches to when no anchor is near
   * (`objectAt` of the app: not a connector, a comment or a frame's open area); hit with the
   * select tool's stroke tolerance at the zoom.
   *
   * @param world - The point, world units.
   * @param zoom - The camera zoom, CSS px per world unit.
   * @returns The object's id, or `undefined` over empty board.
   */
  readonly objectAt: (world: Point, zoom: number) => ObjectId | undefined;
  /** Selects objects with the select tool: the connector just drawn. */
  readonly selectObjects: (ids: readonly ObjectId[]) => void;
  /** Ends the mode from inside it (Escape with no connector under way): back to select. */
  readonly requestExit: () => void;
}
