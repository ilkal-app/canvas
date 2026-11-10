import type { ReactElement } from 'react';

import type { InkableColor } from '@canvas/schema';

import { ColourButton } from '../../controls/colour-button.js';
import type { IconName } from '../../icons/icon-paths.js';
import {
  SHAPE_PANEL_KINDS,
  SHAPES_CHOICES,
  shapesToolStyle,
  type ShapePanelKind,
  type ShapesChoices,
} from '../../state/panel-choices/shapes-choices.js';

import {
  colourLabelOf,
  colourOfValue,
  colourSwatchOf,
  colourValueOf,
  panelPaletteOf,
} from './panel-colours.js';
import { PANEL_ITEM, PanelDivider, PanelIconButton } from './panel-controls.js';
import styles from './panel-controls.module.css';
import { defineToolPanel, type ToolPanelContentsProps } from './tool-panel-contribution.js';

/** Each shape kind's name and icon in the Shapes panel. */
const KINDS: Readonly<Record<ShapePanelKind, { readonly label: string; readonly icon: IconName }>> =
  {
    rectangle: { label: 'Rectangle', icon: 'rectangle' },
    ellipse: { label: 'Ellipse', icon: 'ellipse' },
    triangle: { label: 'Triangle', icon: 'triangle' },
    polygon: { label: 'Polygon', icon: 'polygon' },
    star: { label: 'Star', icon: 'star' },
  };

/**
 * A panel colour button: its value, name and swatch from the colour, and a chosen value back as
 * a colour (a malformed one ignored).
 *
 * @param props - Its name, colour, which of Ink and None it may be, and the setter.
 * @param props.label - Its name ("Fill").
 * @param props.color - The colour, or `null` for none.
 * @param props.canBeInk - Whether it may be ink.
 * @param props.canBeNone - Whether it may be none.
 * @param props.onChange - Receives a colour chosen.
 * @returns The button.
 */
export function PanelColourButton(props: {
  readonly label: string;
  readonly color: InkableColor | null;
  readonly canBeInk: boolean;
  readonly canBeNone: boolean;
  readonly onChange: (color: InkableColor | null) => void;
}): ReactElement {
  return (
    <ColourButton
      label={props.label}
      value={colourValueOf(props.color)}
      valueLabel={colourLabelOf(props.color)}
      swatch={colourSwatchOf(props.color)}
      groups={panelPaletteOf({ canBeInk: props.canBeInk, canBeNone: props.canBeNone })}
      dataAttributes={PANEL_ITEM}
      onChange={(value) => {
        const color = colourOfValue(value);
        if (color !== undefined) props.onChange(color);
      }}
    />
  );
}

/**
 * The Shapes panel's contents (the design's SHAPES card): the five kinds (the block arrow
 * is out of v1), a divider, then the fill and stroke colours. Each choice is the next shape's.
 *
 * @param props - The choices and their setter.
 * @returns The contents.
 */
function ShapesPanelContents(props: ToolPanelContentsProps<ShapesChoices>): ReactElement {
  const { choices, onChange } = props;
  return (
    <>
      <div role="group" aria-label="Shape" className={styles.group}>
        {SHAPE_PANEL_KINDS.map((kind) => (
          <PanelIconButton
            key={kind}
            label={KINDS[kind].label}
            icon={KINDS[kind].icon}
            isPressed={choices.kind === kind}
            onSelect={() => {
              onChange({ ...choices, kind });
            }}
          />
        ))}
      </div>
      <PanelDivider />
      <PanelColourButton
        label="Fill"
        color={choices.fill}
        canBeInk={false}
        canBeNone
        onChange={(fill) => {
          // A fill is never ink.
          if (fill !== 'ink') onChange({ ...choices, fill });
        }}
      />
      <PanelColourButton
        label="Stroke"
        color={choices.stroke}
        canBeInk
        canBeNone
        onChange={(stroke) => {
          onChange({ ...choices, stroke });
        }}
      />
    </>
  );
}

/** The Shapes panel: its kind, fill and stroke become the shape tool's style. */
export const toolPanel = defineToolPanel<ShapesChoices>({
  id: 'shapes',
  label: 'Shapes',
  codec: SHAPES_CHOICES,
  toolStyle: (choices) => ({ tool: 'shape', style: shapesToolStyle(choices) }),
  contents: ShapesPanelContents,
});
