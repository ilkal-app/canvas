import { useState, type ReactElement } from 'react';

import {
  frameCornerRadii,
  isFrameNameShown,
  type BoardObject,
  type CornerRadii,
  type FrameObject,
  type Paint,
} from '@canvas/schema';

import controls from '../controls/controls.module.css';
import { commonValue, MIXED, type Mixable } from '../controls/mixed-value.js';
import { NumberControl } from '../controls/number-control.js';
import { ToggleControl } from '../controls/toggle-control.js';
import { PaintControl, type PaintEdit } from '../paint/paint-control.js';
import { isSamePaint } from '../paint/paint-value.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';

/**
 * A frame's background; null for anything else (which the section never shows for).
 *
 * @param object - The object.
 * @returns Its background.
 */
function backgroundOf(object: BoardObject | undefined): Paint | null {
  return object?.type === 'frame' ? object.background : null;
}

/** The largest corner radius the field takes, as a shape's. */
const MAX_CORNER_RADIUS = 1000;

/** The four corners' fields, in the stored order. */
const CORNERS = [
  { label: 'Top left radius', shortLabel: 'TL' },
  { label: 'Top right radius', shortLabel: 'TR' },
  { label: 'Bottom right radius', shortLabel: 'BR' },
  { label: 'Bottom left radius', shortLabel: 'BL' },
] as const;

/**
 * A frame's one corner radius, or {@link MIXED} when its four corners differ. Absent
 * reads 0.
 *
 * @param frame - The frame.
 * @returns The radius it shows.
 */
function uniformRadiusOf(frame: FrameObject): Mixable<number> {
  const radii = frameCornerRadii(frame.cornerRadius);
  return radii.every((radius) => radius === radii[0]) ? radii[0] : MIXED;
}

/**
 * A frame's radii with one corner set.
 *
 * @param frame - The frame.
 * @param corner - The corner's index, top-left clockwise.
 * @param radius - Its new radius.
 * @returns The four radii.
 */
function withCorner(frame: FrameObject, corner: number, radius: number): CornerRadii {
  const radii: [number, number, number, number] = [...frameCornerRadii(frame.cornerRadius)];
  radii[corner] = radius;
  return radii;
}

/**
 * The frame section's corner radius: one radius for all four corners of every selected
 * frame ("Mixed" when the frames, or one frame's corners, differ) and, behind "Independent
 * corners", each corner's own field ("Mixed" when the frames differ there), which keeps the other
 * corners. Each committed change is one `setStyle`.
 *
 * @param props - The selected frames and how to restyle them.
 * @param props.frames - The selected frames.
 * @param props.applyStyle - Applies a style to the selection.
 * @returns The controls.
 */
function CornerRadiusControls(props: {
  readonly frames: readonly FrameObject[];
  readonly applyStyle: StylePanelSectionProps['applyStyle'];
}): ReactElement {
  const { frames, applyStyle } = props;
  const [isEachCorner, setEachCorner] = useState(false);
  const radius = commonValue(frames, uniformRadiusOf) ?? MIXED;
  return (
    <>
      <NumberControl
        label="Corner radius"
        value={radius}
        min={0}
        max={MAX_CORNER_RADIUS}
        onChange={(chosen) => {
          applyStyle({ cornerRadius: chosen });
        }}
      />
      <div className={controls.control}>
        <ToggleControl label="Independent corners" value={isEachCorner} onChange={setEachCorner} />
      </div>
      {isEachCorner &&
        CORNERS.map(({ label, shortLabel }, corner) => (
          <NumberControl
            key={label}
            label={label}
            shortLabel={shortLabel}
            value={
              commonValue(frames, (frame) => frameCornerRadii(frame.cornerRadius)[corner]) ?? MIXED
            }
            min={0}
            max={MAX_CORNER_RADIUS}
            onChange={(chosen) => {
              applyStyle((object) =>
                object?.type === 'frame'
                  ? { cornerRadius: withCorner(object, corner, chosen) }
                  : {},
              );
            }}
          />
        ))}
    </>
  );
}

/**
 * The style panel's frame section: the selected frames' background, a colour, a linear or
 * radial gradient, an image or none ("Mixed" when they differ), whether they clip their
 * children, a toggle (mixed when they differ), and whether their names are shown, a
 * toggle showing each frame's resolved value (`isFrameNameShown` over the board: a frame never
 * given one hides its name inside another frame or a component and shows it otherwise), which
 * writes an explicit `showName`, and their corner radius: one radius for all four corners
 * ("Mixed" when the frames, or one frame's corners, differ), and, behind "Independent corners",
 * each corner's own (each "Mixed" when the frames differ there). Each committed change is one
 * `setStyle` on the selected frames it changes, one undo step.
 *
 * @param props - The panel's props.
 * @returns The controls.
 */
function FrameSection(props: StylePanelSectionProps): ReactElement {
  const { selection, board, applyStyle } = props;
  const frames = selection.flatMap((object) => (object.type === 'frame' ? [object] : []));
  const clip = commonValue(frames, (frame) => frame.clip) ?? MIXED;
  const isShown = (frame: FrameObject) => isFrameNameShown(frame, (id) => board.get(id));
  const showName = commonValue(frames, isShown) ?? MIXED;
  const editBackground = (edit: PaintEdit) => {
    const nexts = frames.map((frame) => edit(frame.background));
    const [first] = nexts;
    // One background for every frame (None, a picked colour): one plain style change.
    if (first !== undefined && nexts.every((next) => isSamePaint(next, first))) {
      applyStyle({ background: first });
      return;
    }
    applyStyle((object) => {
      if (object?.type !== 'frame') return {};
      const own = backgroundOf(object);
      const next = edit(own);
      return next === own ? {} : { background: next };
    });
  };
  return (
    <>
      <PaintControl
        label="Background"
        paints={frames.map(backgroundOf)}
        canBeNone
        onEdit={editBackground}
        imageTargets={frames.map((frame) => frame.id)}
        onCrop={
          frames.length === 1 && selection.length === 1 && frames[0]?.locked === false
            ? () => {
                props.dispatch({ type: 'selection', command: 'cropImageFill' });
              }
            : undefined
        }
      />
      <div className={controls.control}>
        <ToggleControl
          label="Clip content"
          value={clip}
          onChange={(isClipped) => {
            applyStyle({ clip: isClipped });
          }}
        />
      </div>
      <CornerRadiusControls frames={frames} applyStyle={applyStyle} />
      <div className={controls.control}>
        <ToggleControl
          label="Show name"
          value={showName}
          onChange={(isShown) => {
            applyStyle({ showName: isShown });
          }}
        />
      </div>
    </>
  );
}

/**
 * The style panel's frame section: shown when only frames are selected (the `frame`
 * context); the frame tool keeps no style of its own, so the section needs a selection.
 */
export const stylePanelSection: StylePanelSection = {
  id: 'frame',
  title: 'Frame',
  context: 'frame',
  order: 5,
  isSelectionOnly: true,
  render: FrameSection,
};
