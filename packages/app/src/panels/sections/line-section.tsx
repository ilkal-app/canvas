import { useRef, type ReactElement } from 'react';

import type { StylePatch } from '@canvas/document';
import {
  INK,
  LINE_CAPS,
  type BoardObject,
  type InkableColor,
  type LineCap,
  type Stroke,
} from '@canvas/schema';

import type { IconName } from '../../icons/icon-paths.js';
import { Icon } from '../../icons/icon.js';
import { DEFAULT_LINE_STYLE } from '../../tool-styles/line-style.js';
import { useRovingFocus } from '../../toolbar/use-roving-focus.js';
import { ColourControl } from '../controls/colour-control.js';
import controls from '../controls/controls.module.css';
import { commonValue, isSameColour, MIXED } from '../controls/mixed-value.js';
import { NumberControl } from '../controls/number-control.js';
import { SelectControl, type SelectOption } from '../controls/select-control.js';
import { ToggleControl } from '../controls/toggle-control.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';

import { StrokeStyleControls } from './stroke-style-controls.js';

/** The thinnest stroke the width field accepts, and its step, world px. */
const STROKE_WIDTH_STEP = 0.5;

/** The widest stroke (`MAX_STROKE_WIDTH` of the schema), world px. */
const MAX_STROKE_WIDTH = 64;

/** What each cap is called in the lists. */
const CAP_LABELS: Readonly<Record<LineCap, string>> = {
  none: 'None',
  arrow: 'Arrow',
  triangle: 'Triangle',
  circle: 'Circle',
  diamond: 'Diamond',
};

const CAP_OPTIONS: readonly SelectOption[] = LINE_CAPS.map((cap) => ({
  value: cap,
  label: CAP_LABELS[cap],
}));

/** A route the line section offers. */
type Route = NonNullable<StylePatch['route']>;

/** A line's routes, as icons (the reference card's "Route: straight"); a connector can also curve. */
const LINE_ROUTES: readonly (readonly [Route, IconName])[] = [
  ['straight', 'line'],
  ['elbow', 'elbow-connector'],
];
const CONNECTOR_ROUTES: readonly (readonly [Route, IconName])[] = [
  ...LINE_ROUTES,
  ['curved', 'route-curved'],
];

/** Props of {@link RouteButtons}. */
interface RouteButtonsProps {
  /** The routes offered. */
  readonly routes: readonly (readonly [Route, IconName])[];
  /** The selection's route, or {@link MIXED}. */
  readonly value: string | typeof MIXED;
  /** Receives the route chosen. */
  readonly onChoose: (route: Route) => void;
}

/**
 * The route's icon buttons: one toggle per route, the one in use pressed (none when
 * the selection disagrees), named "Route: straight" and so on; one tab stop, the arrows move
 * along them.
 *
 * @param props - The routes, the value and the handler.
 * @returns The group.
 */
function RouteButtons(props: RouteButtonsProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const roving = useRovingFocus(ref);
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Route"
      className={controls.control}
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
    >
      {props.routes.map(([route, icon]) => (
        <ToggleControl
          key={route}
          label={`Route: ${route}`}
          value={props.value !== MIXED && props.value === route}
          isRovingItem
          onChange={() => {
            props.onChoose(route);
          }}
        >
          <Icon name={icon} />
        </ToggleControl>
      ))}
    </div>
  );
}

/** The line fields of one line, one connector or the line tool's style. */
interface LineFields {
  readonly stroke: Stroke;
  readonly startCap: LineCap;
  readonly endCap: LineCap;
  readonly route: string;
}

/**
 * A line's or connector's fields; the line tool's style (its defaults under what is set) for
 * none.
 *
 * @param object - The object, or undefined for the tool's style.
 * @param defaults - The tool's style, as far as it is set.
 * @returns The fields.
 */
function fieldsOf(object: BoardObject | undefined, defaults: StylePatch | undefined): LineFields {
  if (object?.type === 'line' || object?.type === 'connector') return object;
  return {
    stroke: defaults?.stroke ?? DEFAULT_LINE_STYLE.stroke,
    startCap: defaults?.startCap ?? DEFAULT_LINE_STYLE.startCap,
    endCap: defaults?.endCap ?? DEFAULT_LINE_STYLE.endCap,
    route: defaults?.route ?? DEFAULT_LINE_STYLE.route,
  };
}

/**
 * Sets the stroke colour of each line (or the tool's): a colour, `ink` (the Ink swatch's pick)
 * or a board colour token, each keeping its own width; a line has no none.
 *
 * @param applyStyle - The panel's `applyStyle`.
 * @param strokeFor - A line's stroke, or the tool's.
 * @returns The setter.
 */
function strokeColourSetter(
  applyStyle: StylePanelSectionProps['applyStyle'],
  strokeFor: (object: BoardObject | undefined) => Stroke,
): (color: InkableColor | null) => void {
  return (color) => {
    if (color === null) return;
    applyStyle((object) => ({ stroke: { ...strokeFor(object), color } }), color === INK);
  };
}

/**
 * The style panel's line section: stroke colour (a tuple, the theme-aware `ink` offered by
 * an Ink swatch, or a board colour token) and width, the cap at each end, for selected lines and
 * connectors the dash, join and cap of the stroke (`StrokeStyleControls`), and the route
 * (icons), for lines and connectors or, with the line or connector tool active and nothing
 * selected, for the tool's style (a connector's, and the connector tool's, route can also curve,
 *). A mixed selection shows "Mixed" and a choice sets that field alone; each committed
 * choice is one `setStyle`, one undo step (a colour keeps each object's own width, a width its own
 * colour).
 *
 * @param props - The panel's props.
 * @returns The controls.
 */
export function LineControls(props: StylePanelSectionProps): ReactElement {
  const { selection, defaults, applyStyle } = props;
  const all = selection.length > 0 ? selection.map((object) => fieldsOf(object, defaults)) : [];
  const fields = all.length > 0 ? all : [fieldsOf(undefined, defaults)];
  const strokeFor = (object: BoardObject | undefined) => fieldsOf(object, defaults).stroke;
  const colour =
    commonValue(fields, (line): InkableColor => line.stroke.color, isSameColour) ?? MIXED;
  const width = commonValue(fields, (line) => line.stroke.width) ?? MIXED;
  const startCap = commonValue(fields, (line) => line.startCap) ?? MIXED;
  const endCap = commonValue(fields, (line) => line.endCap) ?? MIXED;
  const route = commonValue(fields, (line) => line.route) ?? MIXED;
  // A connector can curve: a selection holding one, or the connector tool's style.
  const hasConnector =
    selection.length > 0
      ? selection.some((object) => object.type === 'connector')
      : props.activeTool === 'connector';
  const canCurve = (object: BoardObject | undefined): boolean =>
    object === undefined ? hasConnector : object.type === 'connector';
  const setColour = strokeColourSetter(applyStyle, strokeFor);
  return (
    <>
      <ColourControl
        label="Stroke"
        value={colour}
        onChange={setColour}
        onInk={() => {
          setColour(INK);
        }}
        onToken={setColour}
      />
      <NumberControl
        label="Width"
        value={width}
        min={STROKE_WIDTH_STEP}
        max={MAX_STROKE_WIDTH}
        step={STROKE_WIDTH_STEP}
        onChange={(chosen) => {
          applyStyle((object) => ({ stroke: { ...strokeFor(object), width: chosen } }));
        }}
      />
      <SelectControl
        label="Start cap"
        value={startCap}
        options={CAP_OPTIONS}
        onChange={(chosen) => {
          applyStyle({ startCap: chosen as LineCap });
        }}
      />
      <SelectControl
        label="End cap"
        value={endCap}
        options={CAP_OPTIONS}
        onChange={(chosen) => {
          applyStyle({ endCap: chosen as LineCap });
        }}
      />
      <StrokeStyleControls {...props} />
      <RouteButtons
        routes={hasConnector ? CONNECTOR_ROUTES : LINE_ROUTES}
        value={route}
        onChoose={(chosenRoute) => {
          // A line cannot curve: a mixed selection's lines keep their route.
          applyStyle((object) =>
            chosenRoute === 'curved' && !canCurve(object) ? {} : { route: chosenRoute },
          );
          // A selected connector must not hide the choice from the next connector.
          if (selection.some((object) => object.type === 'connector')) {
            props.dispatch({
              type: 'setToolStyle',
              tool: 'connector',
              style: { route: chosenRoute },
            });
          }
        }}
      />
    </>
  );
}

/** The line section: shown for lines and connectors, and for the line and connector tools' styles. */
export const stylePanelSection: StylePanelSection = {
  id: 'line',
  title: 'Line',
  context: 'line',
  order: 100,
  render: LineControls,
};
