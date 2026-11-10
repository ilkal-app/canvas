import type { StylePatch } from '@canvas/document';
import { CONNECTOR_ROUTES, inkableColorSchema, type InkableColor } from '@canvas/schema';

import { storedField, type ToolPanelChoiceCodec } from '../tool-panel-choices.js';

/**
 * Which ends of a connector carry a cap: none (a plain line), the end, or both.
 */
export const CONNECTOR_PANEL_ENDS = ['none', 'end', 'both'] as const;

/** One of {@link CONNECTOR_PANEL_ENDS}. */
export type ConnectorPanelEnds = (typeof CONNECTOR_PANEL_ENDS)[number];

/** The cap styles the Connector panel offers: every line cap but none. */
export const CONNECTOR_PANEL_CAPS = ['arrow', 'triangle', 'circle', 'diamond'] as const;

/** One of {@link CONNECTOR_PANEL_CAPS}. */
export type ConnectorPanelCap = (typeof CONNECTOR_PANEL_CAPS)[number];

/** The stroke widths the Connector panel offers, world units. */
export const CONNECTOR_PANEL_WIDTHS = [1, 2, 4] as const;

/** One of {@link CONNECTOR_PANEL_WIDTHS}. */
export type ConnectorPanelWidth = (typeof CONNECTOR_PANEL_WIDTHS)[number];

/** A connector's route. */
export type ConnectorPanelRoute = (typeof CONNECTOR_ROUTES)[number];

/** What the Connector panel holds: the next connector's route, ends, cap, width and colour. */
export interface ConnectorChoices {
  /** Straight, elbow or curved. */
  readonly route: ConnectorPanelRoute;
  /** Which ends carry the cap. */
  readonly ends: ConnectorPanelEnds;
  /** The cap's style. */
  readonly cap: ConnectorPanelCap;
  /** The stroke width. */
  readonly width: ConnectorPanelWidth;
  /** The stroke colour; `ink` allowed. */
  readonly color: InkableColor;
}

/**
 * Tells whether a value is one of a list's members.
 *
 * @param list - The list.
 * @returns The check.
 */
function memberOf<T>(list: readonly T[]): (value: unknown) => value is T {
  return (value): value is T => (list as readonly unknown[]).includes(value);
}

const isColor = (value: unknown): value is InkableColor =>
  inkableColorSchema.safeParse(value).success;

/**
 * The Connector panel's choices: an elbow connector with an arrow at its end, 2 units
 * wide, in `ink`; a stored field that is not valid takes its default.
 */
export const CONNECTOR_CHOICES: ToolPanelChoiceCodec<ConnectorChoices> = {
  id: 'connector',
  defaults: { route: 'elbow', ends: 'end', cap: 'arrow', width: 2, color: 'ink' },
  parse: (stored) => {
    const { defaults } = CONNECTOR_CHOICES;
    return {
      route: storedField(stored, 'route', memberOf(CONNECTOR_ROUTES), defaults.route),
      ends: storedField(stored, 'ends', memberOf(CONNECTOR_PANEL_ENDS), defaults.ends),
      cap: storedField(stored, 'cap', memberOf(CONNECTOR_PANEL_CAPS), defaults.cap),
      width: storedField(stored, 'width', memberOf(CONNECTOR_PANEL_WIDTHS), defaults.width),
      color: storedField(stored, 'color', isColor, defaults.color),
    };
  },
};

/**
 * The connector tool's style the Connector panel's choices give: the route, the cap at
 * the ends chosen (none at either for a plain line) and the stroke. Pure.
 *
 * @param choices - The panel's choices.
 * @returns The style the next connector takes.
 */
export function connectorToolStyle(choices: ConnectorChoices): StylePatch {
  const { route, ends, cap, width, color } = choices;
  return {
    route,
    startCap: ends === 'both' ? cap : 'none',
    endCap: ends === 'none' ? 'none' : cap,
    stroke: { color: structuredClone(color), width },
  };
}
