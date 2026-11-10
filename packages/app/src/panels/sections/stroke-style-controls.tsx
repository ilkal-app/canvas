import type { ReactElement } from 'react';

import type { StylePatch } from '@canvas/document';
import {
  DEFAULT_STROKE_MITER_LIMIT,
  MAX_STROKE_MITER_LIMIT,
  type BoardObject,
  type ConnectorObject,
  type LineCap,
  type LineObject,
  type PathObject,
  type StrokeCap,
  type StrokeDash,
  type StrokeJoin,
  type StrokeStyle,
} from '@canvas/schema';
import type { ToolId } from '@canvas/tools';

import { connectorToolStyleOf } from '../../tool-styles/connector-style.js';
import { lineToolStyleOf } from '../../tool-styles/line-style.js';
import { penToolStyleOf } from '../../tool-styles/pen-style.js';
import { commonValue, MIXED } from '../controls/mixed-value.js';
import { NumberControl } from '../controls/number-control.js';
import { SelectControl, type SelectOption } from '../controls/select-control.js';
import type { StylePanelSectionProps } from '../panel-sections.js';

import { dashKindOf, dashPatch } from './stroke-style-presets.js';

/** An object whose stroke can be dashed, joined and capped. */
type StyledStroke = PathObject | LineObject | ConnectorObject;

/** A creation tool whose new strokes take a stroke style. */
type StrokeTool = 'pen' | 'line' | 'connector';

/**
 * What the controls read and edit, for a selected object or a creation tool's style: the
 * stroke's width, its dash, join, miter limit and cap, and whether its cap shows.
 */
interface StrokeStyleView {
  /** The stroke's width, world px; undefined without a stroke. */
  readonly width: number | undefined;
  /** The dash; null or undefined for solid. */
  readonly strokeDash: StrokeDash | null | undefined;
  /** The join; undefined for round. */
  readonly strokeJoin: StrokeJoin | undefined;
  /** The miter limit; undefined for the default. */
  readonly strokeMiterLimit: number | undefined;
  /** The cap; undefined for round. */
  readonly strokeCap: StrokeCap | undefined;
  /** Whether the Cap list applies to it. */
  readonly hasCap: boolean;
}

const DASH_OPTIONS: readonly SelectOption[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
];

/** What a custom pattern (one set through MCP or an SVG import) shows; not choosable. */
const CUSTOM_OPTION: SelectOption = { value: 'custom', label: 'Custom' };

const JOIN_OPTIONS: readonly SelectOption[] = [
  { value: 'round', label: 'Round' },
  { value: 'miter', label: 'Miter' },
  { value: 'bevel', label: 'Bevel' },
];

const CAP_OPTIONS: readonly SelectOption[] = [
  { value: 'round', label: 'Round' },
  { value: 'butt', label: 'Butt' },
  { value: 'square', label: 'Square' },
];

/**
 * Whether an object's stroke takes a stroke style: a path, line or connector.
 *
 * @param object - The object.
 * @returns True for those types.
 */
function isStyledStroke(object: BoardObject): object is StyledStroke {
  return object.type === 'path' || object.type === 'line' || object.type === 'connector';
}

/**
 * Whether a creation tool's new strokes take a stroke style.
 *
 * @param tool - The tool, if any.
 * @returns True for the pen, line and connector tools.
 */
function isStrokeTool(tool: ToolId | undefined): tool is StrokeTool {
  return tool === 'pen' || tool === 'line' || tool === 'connector';
}

/**
 * Whether the Cap list applies to a stroke: always on a path; on a line or connector when one of
 * its ends has no decoration (the cap ends it) or its shaft is dashed (the cap ends every dash).
 *
 * @param isPath - Whether it is a path's (or the pen's).
 * @param ends - Its decorations.
 * @param ends.startCap - At the start.
 * @param ends.endCap - At the end.
 * @param dash - Its dash.
 * @returns True when the cap shows.
 */
function capApplies(
  isPath: boolean,
  ends: { readonly startCap: LineCap; readonly endCap: LineCap },
  dash: StrokeDash | null | undefined,
): boolean {
  return isPath || ends.startCap === 'none' || ends.endCap === 'none' || Boolean(dash);
}

/**
 * A selected object's stroke style.
 *
 * @param object - The object.
 * @returns What the controls show for it.
 */
function objectView(object: StyledStroke): StrokeStyleView {
  const ends = object.type === 'path' ? ({ startCap: 'none', endCap: 'none' } as const) : object;
  return {
    width: object.stroke?.width,
    strokeDash: object.strokeDash,
    strokeJoin: object.strokeJoin,
    strokeMiterLimit: object.strokeMiterLimit,
    strokeCap: object.strokeCap,
    hasCap: capApplies(object.type === 'path', ends, object.strokeDash),
  };
}

/**
 * A creation tool's stroke style, its style resolved over the tool's own defaults as
 * the tool draws it (`penToolStyleOf`, `lineToolStyleOf`, `connectorToolStyleOf`).
 *
 * @param tool - The tool.
 * @param defaults - Its style as the panel holds it.
 * @returns What the controls show for it.
 */
function toolView(tool: StrokeTool, defaults: StylePatch | undefined): StrokeStyleView {
  if (tool === 'pen') {
    const style = penToolStyleOf(defaults);
    const ends = { startCap: 'none', endCap: 'none' } as const;
    return {
      ...fieldsOf(style),
      width: style.stroke?.width,
      hasCap: capApplies(true, ends, null),
    };
  }
  const style = tool === 'line' ? lineToolStyleOf(defaults) : connectorToolStyleOf(defaults);
  return {
    ...fieldsOf(style),
    width: style.stroke.width,
    hasCap: capApplies(false, style, style.strokeDash),
  };
}

/**
 * The stroke style fields of a tool's resolved style, each undefined when unset.
 *
 * @param style - The style.
 * @returns The fields.
 */
function fieldsOf(style: StrokeStyle): Omit<StrokeStyleView, 'width' | 'hasCap'> {
  return {
    strokeDash: style.strokeDash,
    strokeJoin: style.strokeJoin,
    strokeMiterLimit: style.strokeMiterLimit,
    strokeCap: style.strokeCap,
  };
}

/**
 * The stroke style controls of the style panel, for the paths, lines and
 * connectors of a selection or, with nothing selected, for the pen, line or connector tool's
 * style, which the tool's new strokes take: a Dash list (Solid, Dashed, Dotted; a
 * pattern set elsewhere shows Custom), a Join list (Round, Miter, Bevel) with the miter limit
 * while the joins are mitred, and a Cap list (Round, Butt, Square), shown on a line or connector
 * (or their tool) only while an end has no decoration or its shaft is dashed. Absent fields show
 * as the drawing they give: solid, round. A preset is scaled by the stroke's width, or the
 * tool's. Each choice is one `applyStyle`: one undo step on a selection, where objects of other
 * types are left alone, or one change of the tool's style, which writes nothing to the board.
 *
 * @param props - The panel's props.
 * @returns The controls, or nothing without such an object or tool.
 */
export function StrokeStyleControls(
  props: Pick<StylePanelSectionProps, 'selection' | 'applyStyle'> &
    Partial<Pick<StylePanelSectionProps, 'defaults' | 'activeTool'>>,
): ReactElement | null {
  const { selection, applyStyle, defaults, activeTool } = props;
  const strokes = selection.filter(isStyledStroke);
  const tool = selection.length === 0 && isStrokeTool(activeTool) ? activeTool : undefined;
  const views = tool === undefined ? strokes.map(objectView) : [toolView(tool, defaults)];
  if (views.length === 0) return null;
  const dash = commonValue(views, (view) => dashKindOf(view.strokeDash, view.width)) ?? MIXED;
  const join = commonValue(views, (view): StrokeJoin => view.strokeJoin ?? 'round') ?? MIXED;
  const miterLimit =
    commonValue(views, (view) => view.strokeMiterLimit ?? DEFAULT_STROKE_MITER_LIMIT) ?? MIXED;
  const capped = views.filter((view) => view.hasCap);
  const cap = commonValue(capped, (view): StrokeCap => view.strokeCap ?? 'round') ?? MIXED;
  const [toolStyle] = views;
  return (
    <>
      <SelectControl
        label="Dash"
        value={dash}
        options={dash === 'custom' ? [...DASH_OPTIONS, CUSTOM_OPTION] : DASH_OPTIONS}
        onChange={(chosen) => {
          if (chosen === 'custom') return;
          if (tool !== undefined && toolStyle !== undefined) {
            applyStyle(dashPatch(chosen, toolStyle));
            return;
          }
          applyStyle((object) =>
            object !== undefined && isStyledStroke(object)
              ? dashPatch(chosen, objectView(object))
              : {},
          );
        }}
      />
      <SelectControl
        label="Join"
        value={join}
        options={JOIN_OPTIONS}
        onChange={(chosen) => {
          applyStyle({ strokeJoin: chosen as StrokeJoin });
        }}
      />
      {join === 'miter' && (
        <NumberControl
          label="Miter limit"
          value={miterLimit}
          min={1}
          max={MAX_STROKE_MITER_LIMIT}
          step={1}
          onChange={(chosen) => {
            applyStyle({ strokeMiterLimit: chosen });
          }}
        />
      )}
      {capped.length > 0 && (
        <SelectControl
          label="Cap"
          value={cap}
          options={CAP_OPTIONS}
          onChange={(chosen) => {
            applyStyle({ strokeCap: chosen as StrokeCap });
          }}
        />
      )}
    </>
  );
}
